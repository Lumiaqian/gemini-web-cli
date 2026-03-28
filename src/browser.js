/**
 * browser.js — 浏览器客户端连接器（面向 Skill）
 *
 * 职责：
 *   1. 向 Daemon 服务请求 wsEndpoint，并通过 puppeteer.connect() 直连浏览器。
 *   2. 如果 Daemon 未启动，自动以后台进程拉起 server.js，等待就绪后再连接。
 *
 * 与 Daemon 的关系：
 *   browser.js (Skill 侧)           Daemon (独立进程)
 *   ─────────────────────           ──────────────────
 *   isDaemonAlive()        ──▶     GET /health
 *   spawnDaemon()          ──▶     node src/daemon/server.js (detached)
 *   fetch /browser/acquire ──▶     engine.js: launch/connect
 *   puppeteer.connect(ws)  ──▶     Chrome CDP wsEndpoint
 *   disconnect()           ──▶     浏览器继续由 Daemon 守护
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import puppeteerCore from 'puppeteer-core';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import config from './config.js';
import { sleep } from './util.js';

// connect 也套上 Stealth，双保险
const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

// ── 路径常量 ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DAEMON_SCRIPT = join(__dirname, 'daemon', 'server.js');

// ── 模块级单例 ──
let _browser = null;

const DAEMON_URL = `http://127.0.0.1:${config.daemonPort}`;

// ── Daemon 自启动配置 ──
/** 拉起 Daemon 后，等待就绪的最长时间（ms） */
const DAEMON_READY_TIMEOUT = 15_000;
/** 轮询间隔（ms） */
const DAEMON_POLL_INTERVAL = 500;

/**
 * 检查 Daemon 是否存活
 * @returns {Promise<boolean>}
 */
async function isDaemonAlive() {
  try {
    const res = await fetch(`${DAEMON_URL}/health`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

/**
 * 以后台 detached 进程方式启动 Daemon
 *
 * 关键：
 *   - detached: true → Daemon 独立于当前进程组，Skill 退出不影响它
 *   - stdio: 'ignore' → 不绑定当前终端的 stdin/stdout/stderr
 *   - unref() → 当前进程不再等待 Daemon 子进程退出
 */
function spawnDaemon() {
  console.log(`[browser] 🚀 Daemon 未运行，正在自动启动: node ${DAEMON_SCRIPT}`);

  const child = spawn(process.execPath, [DAEMON_SCRIPT], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },   // 继承环境变量（含 DAEMON_PORT / BROWSER_HEADLESS 等配置）
  });

  child.unref();
  console.log(`[browser] Daemon 进程已分离 (pid=${child.pid})，等待就绪...`);
}

/**
 * 确保 Daemon 可用 — 如果没启动则自动拉起并等待就绪
 * @returns {Promise<void>}
 */
async function ensureDaemon() {
  // 先探测一次
  if (await isDaemonAlive()) {
    return; // 已经活着
  }

  // 拉起 Daemon
  spawnDaemon();

  // 轮询等待就绪
  const deadline = Date.now() + DAEMON_READY_TIMEOUT;
  while (Date.now() < deadline) {
    await sleep(DAEMON_POLL_INTERVAL);
    if (await isDaemonAlive()) {
      console.log('[browser] ✅ Daemon 就绪');
      return;
    }
  }

  throw new Error(
    `Daemon 自动启动超时（${DAEMON_READY_TIMEOUT / 1000}s 内未响应 /health）！\n` +
    `请检查端口 ${config.daemonPort} 是否被占用，或手动运行: npm run daemon`
  );
}

/**
 * 在浏览器中找到 Gemini 标签页，或新开一个
 * @param {import('puppeteer-core').Browser} browser
 * @returns {Promise<import('puppeteer-core').Page>}
 */
async function findOrCreateGeminiPage(browser) {
  const pages = await browser.pages();

  // 优先复用已有的 Gemini 标签页
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gemini.google.com')) {
      console.log('[browser] 命中已有 Gemini 标签页');
      await page.bringToFront();
      return page;
    }
  }

  // 没找到，新开一个
  const page = pages.length > 0 ? pages[0] : await browser.newPage();
  await page.goto('https://gemini.google.com/app', {
    waitUntil: 'networkidle2',
    timeout: 30_000,
  });
  console.log('[browser] 已打开新的 Gemini 标签页');
  return page;
}

/**
 * 确保浏览器可用 — Skill 唯一的对外入口
 *
 * 流程：
 *   1. 当前进程已连着 → 直接复用
 *   2. 检查 Daemon 是否存活，未存活则自动拉起
 *   3. 向 Daemon 发 HTTP 请求索要 wsEndpoint
 *   4. 通过 WebSocket 直连 Chrome CDP
 *   5. 找到 / 新开 Gemini 标签页
 *
 * @returns {Promise<{browser: import('puppeteer-core').Browser, page: import('puppeteer-core').Page}>}
 */
export async function ensureBrowser() {
  // 1. 复用已有连接
  if (_browser && _browser.isConnected()) {
    const page = await findOrCreateGeminiPage(_browser);
    return { browser: _browser, page };
  }

  // 2. 确保 Daemon 可用（未启动则自动拉起）
  await ensureDaemon();

  // 3. 向 Daemon 索要浏览器连接地址
  let acquireData;
  try {
    console.log(`[browser] 正在呼叫 Daemon: ${DAEMON_URL}/browser/acquire ...`);
    const res = await fetch(`${DAEMON_URL}/browser/acquire`);
    acquireData = await res.json();

    if (!acquireData.ok) {
      const detail = acquireData.detail ? ` (${acquireData.detail})` : '';
      throw new Error(`${acquireData.error || 'Daemon 返回失败'}${detail}`);
    }
  } catch (err) {
    throw new Error(
      `Daemon 已启动但获取浏览器失败！\n` +
      `底层报错: ${err.message}`
    );
  }

  // 4. 拿到 wsEndpoint，通过 WebSocket 直连浏览器
  console.log(`[browser] 从 Daemon 获取到 wsEndpoint，正在建立 CDP 直连...`);
  _browser = await puppeteer.connect({
    browserWSEndpoint: acquireData.wsEndpoint,
    defaultViewport: null,
    protocolTimeout: config.browserProtocolTimeout,
  });

  const page = await findOrCreateGeminiPage(_browser);
  console.log(`[browser] CDP 直连成功，pid=${acquireData.pid}`);
  return { browser: _browser, page };
}

/**
 * 断开 WebSocket 连接（不关闭浏览器）
 *
 * 注意：绝不能调用 browser.close()！
 * 浏览器的生杀大权已经移交给 Daemon 的 TTL 倒计时了。
 */
export function disconnect() {
  if (_browser) {
    _browser.disconnect();
    _browser = null;
    console.log('[browser] 已断开 CDP 连接（浏览器仍由 Daemon 守护）');
  }
}
