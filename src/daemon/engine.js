/**
 * engine.js — 浏览器引擎
 *
 * 职责：
 *   维护 _browser 单例，封装 launch / connect / terminate。
 *   复用项目已有的 stealth 插件、反检测参数、路径检测逻辑。
 *
 * 与 browser.js 的关系：
 *   browser.js 面向 Skill 直接调用（ensureBrowser → 拿到 page）；
 *   engine.js 面向 Daemon 服务（只管浏览器进程生命周期，不关心具体页面）。
 */
import puppeteerCore from 'puppeteer-core';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createConnection } from 'node:net';
import { existsSync, mkdirSync, cpSync } from 'node:fs';
import { platform, homedir } from 'node:os';
import { join, basename } from 'node:path';
import config from '../config.js';

// ── Stealth 包装 ──
const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

// ── 单例 ──
let _browser = null;
let _shuttingDown = false;  // 防止 disconnected 回调与主动 terminate 重入
let _shutdownCallback = null;  // 由 server 注入的关闭回调

/**
 * 注入 Daemon 关闭回调
 *
 * 当浏览器意外断开（如用户手动关闭窗口）时调用此回调，
 * 让 Daemon 进程也一并退出。
 *
 * @param {() => void} cb
 */
export function onBrowserExit(cb) {
  _shutdownCallback = cb;
}

/**
 * 为浏览器实例注册 disconnected 监听
 * 用户手动关闭浏览器窗口 → Puppeteer 触发 disconnected → Daemon 跟着退出
 */
function registerDisconnectHandler(browser) {
  browser.on('disconnected', () => {
    // 如果是主动 terminateBrowser() 触发的断开，跳过
    if (_shuttingDown) return;

    console.log('[engine] 🔌 浏览器连接断开（用户关闭了浏览器窗口？）');
    _browser = null;

    if (_shutdownCallback) {
      _shutdownCallback();
    }
  });
}

// ── 浏览器候选路径 ──
const BROWSER_CANDIDATES = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
};

/** 自动检测系统浏览器 */
function detectBrowser() {
  const envPaths = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA,
  ];

  const os = platform();
  const candidates = [...(BROWSER_CANDIDATES[os] || [])];

  if (os === 'win32') {
    for (const base of envPaths) {
      if (!base) continue;
      candidates.push(
        `${base}\\Google\\Chrome\\Application\\chrome.exe`,
        `${base}\\Microsoft\\Edge\\Application\\msedge.exe`,
      );
    }
  }

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

// ── userDataDir 相关 ──
const GLOBAL_WJZ_DATA_DIR = join(homedir(), '.wjz_browser_data');

function getDefaultBrowserDataDir() {
  const os = platform();
  const home = homedir();
  const candidates = [];

  if (os === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    candidates.push(
      join(localAppData, 'Google', 'Chrome', 'User Data'),
      join(localAppData, 'Microsoft', 'Edge', 'User Data'),
      join(localAppData, 'Chromium', 'User Data'),
    );
  } else if (os === 'darwin') {
    const lib = join(home, 'Library', 'Application Support');
    candidates.push(
      join(lib, 'Google', 'Chrome'),
      join(lib, 'Microsoft Edge'),
      join(lib, 'Chromium'),
    );
  } else {
    candidates.push(
      join(home, '.config', 'google-chrome'),
      join(home, '.config', 'microsoft-edge'),
      join(home, '.config', 'chromium'),
    );
  }

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return undefined;
}

function cloneProfileFromDefault(sourceDir, targetDir) {
  console.log(`[engine] 首次运行，从浏览器默认数据克隆资产: ${sourceDir} → ${targetDir}`);

  const SKIP_NAMES = new Set([
    'singletonlock', 'singletonsocket', 'singletoncookie', 'lockfile',
    'cache', 'code cache', 'gpucache', 'dawncache', 'grshadercache',
    'crashpadmetrics-active.pma', 'browsermetrics', 'browsermetrics-spare.pma',
  ]);

  const filterFunc = (src) => !SKIP_NAMES.has(basename(src).toLowerCase());

  try {
    cpSync(sourceDir, targetDir, { recursive: true, filter: filterFunc });
    console.log('[engine] 克隆完成');
  } catch (err) {
    console.warn(`[engine] ⚠ 克隆出错（浏览器仍可启动，但需重新登录）: ${err.message}`);
  }
}

function resolveUserDataDir() {
  if (config.browserUserDataDir) return config.browserUserDataDir;

  if (existsSync(GLOBAL_WJZ_DATA_DIR)) return GLOBAL_WJZ_DATA_DIR;

  mkdirSync(GLOBAL_WJZ_DATA_DIR, { recursive: true });
  const defaultDir = getDefaultBrowserDataDir();
  if (defaultDir) {
    cloneProfileFromDefault(defaultDir, GLOBAL_WJZ_DATA_DIR);
  }
  return GLOBAL_WJZ_DATA_DIR;
}

// ── 启动参数 ──
const BROWSER_ARGS = [
  // 跳过首次运行的欢迎页 / 引导流程
  '--no-first-run',
  // 不安装默认应用（Gmail、Drive 等 WebStore 推荐）
  '--disable-default-apps',
  // 允许弹窗（防止 Gemini 内部弹窗被拦截）
  '--disable-popup-blocking',
  // 禁用 GPU 硬件加速（无头 / 服务器环境下避免 GPU 相关崩溃）
  '--disable-gpu',
  // 禁用软件光栅化后备（配合 --disable-gpu，彻底走 CPU 渲染）
  '--disable-software-rasterizer',
  // 不使用 /dev/shm 共享内存（Docker / 低内存环境防 OOM）
  '--disable-dev-shm-usage',
  // Linux 环境下关闭沙箱（Docker 内无特权时必需）
  ...(platform() === 'linux'
    ? ['--no-sandbox', '--disable-setuid-sandbox']
    : []),
  // 禁止后台网络请求（如组件更新、安全浏览列表拉取），减少无关流量
  '--disable-background-networking',
  // 禁止后台标签页的定时器节流，保证不在前台时脚本也能正常执行
  '--disable-background-timer-throttling',
  // 禁止浏览器对被遮挡窗口降低优先级
  '--disable-backgrounding-occluded-windows',
  // 禁止渲染进程在后台时被降级，保持页面持续活跃
  '--disable-renderer-backgrounding',
  // 关闭内置翻译条，防止遮挡页面元素影响自动化操作
  '--disable-features=Translate',
  // 跳过"设为默认浏览器"的弹窗检查
  '--no-default-browser-check',
  // 禁用崩溃报告器，避免弹出崩溃上报对话框
  '--disable-crash-reporter',
  // 隐藏"Chrome 未正确关闭"的恢复气泡提示
  '--hide-crash-restore-bubble',
  // 标记为测试模式，跳过部分安全警告（如"不安全的命令行标志"横幅）
  '--test-type',
  // Windows Server 安全策略绕过：防止 Safe Browsing 验毒超时导致浏览器的下载被拦截
  '--safebrowsing-disable-download-protection',
  // 禁用 Safe Browsing 扩展黑名单，防止 stealth 插件被标记拦截
  '--safebrowsing-disable-extension-blacklist',
];

/** 端口探活 */
function isPortAlive(port, host = '127.0.0.1', timeout = 1500) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeout);
    socket.on('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

// ── 公开 API ──

/**
 * 获取当前浏览器实例（可能为 null）
 */
export function getBrowser() {
  return _browser;
}

/**
 * 确保浏览器可用（冷启动 or 复用），返回 browser 实例
 *
 * Daemon 场景：不处理 SIGINT/SIGTERM（由 server.js 统一管理信号）
 */
export async function ensureBrowserForDaemon() {
  const port = config.browserDebugPort;

  // 1. 复用已有连接
  if (_browser && _browser.isConnected()) {
    return _browser;
  }

  // 2. 尝试连接已运行的浏览器
  const alive = await isPortAlive(port);
  if (alive) {
    try {
      _browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${port}`,
        defaultViewport: null,
        protocolTimeout: config.browserProtocolTimeout,
      });
      registerDisconnectHandler(_browser);
      console.log(`[engine] 已连接到端口 ${port} 的浏览器`);
      return _browser;
    } catch (err) {
      console.warn(`[engine] 连接失败: ${err.message}，将尝试启动`);
    }
  }

  // 3. 启动新浏览器
  const executablePath = config.browserPath || detectBrowser();
  if (!executablePath) {
    throw new Error(
      `[engine] 未找到可用浏览器。请设置 BROWSER_PATH 或安装 Chrome/Edge。`
    );
  }

  const userDataDir = resolveUserDataDir();

  _browser = await puppeteer.launch({
    executablePath,
    headless: config.browserHeadless,
    userDataDir,
    defaultViewport: null,
    args: [...BROWSER_ARGS, `--remote-debugging-port=${port}`],
    ignoreDefaultArgs: ['--enable-automation'],
    protocolTimeout: config.browserProtocolTimeout,
    // Daemon 自己管信号，不让 Puppeteer 接管
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });

  const pid = _browser.process()?.pid;
  registerDisconnectHandler(_browser);
  console.log(`[engine] 浏览器已启动 pid=${pid} port=${port} path=${executablePath}`);

  return _browser;
}

/**
 * 终止浏览器进程并清理单例
 */
export async function terminateBrowser() {
  if (!_browser) return;

  _shuttingDown = true;  // 标记主动关闭，防止 disconnected 回调重入

  try {
    const pid = _browser.process()?.pid;
    await _browser.close();
    console.log(`[engine] 浏览器已终止 pid=${pid || 'N/A'}`);
  } catch (err) {
    console.warn(`[engine] 终止浏览器时出错: ${err.message}`);
    // 兜底：强杀进程
    try {
      _browser.process()?.kill('SIGKILL');
    } catch { /* ignore */ }
  } finally {
    _browser = null;
    _shuttingDown = false;
  }
}
