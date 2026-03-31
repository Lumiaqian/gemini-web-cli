/**
 * postinstall.mjs — 用户级配置初始化
 *
 * 在 npm install -g 后自动运行，创建 ~/.gemini-web-cli/config.toml
 *（如果不存在）。用户可以在这个文件里覆盖所有配置项。
 *
 * 优先级（从高到低）：
 *   1. 环境变量（process.env）
 *   2. .env.development / .env（项目目录，git-ignored）
 *   3. ~/.gemini-web-cli/config.toml（用户级默认，永久保留）
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.gemini-web-cli');
const CONFIG_FILE = join(CONFIG_DIR, 'config.toml');

const DEFAULT_CONFIG = `# ~/.gemini-web-cli/config.toml
# 用户级配置文件，npm install -g 后自动创建（如果不存在）。
# 项目目录的 .env 和环境变量会覆盖这里的值。

[daemon]
# 错误日志文件路径（不设则不写文件日志）
# 示例：errorLog = "/tmp/gemini-daemon-error.log"
errorLog = ""

# Daemon HTTP 服务端口
# port = 40225

# Daemon 闲置超时（毫秒），超时后自动终止浏览器
# ttlMs = 1800000

[browser]
# 浏览器可执行文件路径（不设则自动检测 Chrome/Edge/Chromium）
# path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# CDP 远程调试端口
# debugPort = 40821

# 用户数据目录（保持登录态）
# userDataDir = "~/.gemini-skill/browser-data"

# 是否无头模式
# headless = false

# CDP 协议超时（毫秒）
# protocolTimeout = 60000

[output]
# 图片输出目录
# dir = "./gemini-image"
`;

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    console.log('[postinstall] Created config directory:', CONFIG_DIR);
  }
}

function ensureConfigFile() {
  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, DEFAULT_CONFIG, 'utf-8');
    console.log('[postinstall] Created config file:', CONFIG_FILE);
  }
}

ensureConfigDir();
ensureConfigFile();
