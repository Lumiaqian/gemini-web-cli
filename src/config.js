/**
 * config.js — 统一配置中心
 *
 * 所有可配置项集中在这里，从环境变量读取，提供合理默认值。
 * 其他模块一律从 config 取值，不自己硬编码。
 *
 * 优先级（从高到低）：
 *   1. 进程环境变量（process.env）
 *   2. .env.development（开发环境，git-ignored）
 *   3. .env（基础配置，可提交到 git）
 *   4. ~/.gemini-web-cli/config.toml（用户级永久配置，npm install 时自动创建）
 *   5. 代码默认值
 *
 * .env 文件加载说明：
 *   - 本模块内置了轻量级 parseEnvFile 解析器，零外部依赖。
 *   - 作为 skill 库被 import 使用，不应要求调用方修改启动命令或安装额外依赖。
 *   - 如果调用方已通过以下方式加载了 .env，本模块也能无缝工作（process.env 优先级最高）：
 *     · Node.js ≥ v20.6.0: node --env-file=.env --env-file=.env.development app.js
 *     · dotenv 库: dotenv.config({ path: ['.env.development', '.env'] })
 *
 * TOML 文件加载说明：
 *   - ~/.gemini-web-cli/config.toml 由 postinstall 脚本自动创建（如果不存在）
 *   - 优先级最低，用于作为用户级永久默认配置
 *   - 使用 toml 库解析（已在 dependencies 中声明）
 */
import { resolve, homedir, join, dirname } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import toml from 'toml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, 'utf-8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && value) {
      result[key] = value;
    }
  }
  return result;
}

function expandTilde(path) {
  if (!path) return path;
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function fillEnv(vars) {
  for (const [key, value] of Object.entries(vars)) {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = String(value);
    }
  }
}

// 加载顺序：.env.development → .env → config.toml（从不覆盖已存在的 process.env）
const devEnv = parseEnvFile(join(projectRoot, '.env.development'));
const baseEnv = parseEnvFile(join(projectRoot, '.env'));
fillEnv(devEnv);
fillEnv(baseEnv);

// 最低优先级：~/.gemini-web-cli/config.toml
const userConfigPath = join(homedir(), '.gemini-web-cli', 'config.toml');
if (existsSync(userConfigPath)) {
  try {
    const userToml = toml.parse(readFileSync(userConfigPath, 'utf-8'));
    const tomlVars = {};

    if (userToml.daemon) {
      if (userToml.daemon.errorLog) tomlVars.DAEMON_ERROR_LOG = expandTilde(userToml.daemon.errorLog);
      if (userToml.daemon.port) tomlVars.DAEMON_PORT = String(userToml.daemon.port);
      if (userToml.daemon.ttlMs) tomlVars.DAEMON_TTL_MS = String(userToml.daemon.ttlMs);
    }
    if (userToml.browser) {
      if (userToml.browser.path) tomlVars.BROWSER_PATH = expandTilde(userToml.browser.path);
      if (userToml.browser.debugPort) tomlVars.BROWSER_DEBUG_PORT = String(userToml.browser.debugPort);
      if (userToml.browser.userDataDir) tomlVars.BROWSER_USER_DATA_DIR = expandTilde(userToml.browser.userDataDir);
      if (userToml.browser.headless !== undefined) tomlVars.BROWSER_HEADLESS = String(userToml.browser.headless);
      if (userToml.browser.protocolTimeout) tomlVars.BROWSER_PROTOCOL_TIMEOUT = String(userToml.browser.protocolTimeout);
    }
    if (userToml.output) {
      if (userToml.output.dir) tomlVars.OUTPUT_DIR = expandTilde(userToml.output.dir);
    }

    fillEnv(tomlVars);
  } catch (err) {
    // 无视 TOML 解析错误，不阻塞启动
  }
}

const env = process.env;

function envBool(key, fallback) {
  const val = env[key];
  if (val === undefined || val === '') return fallback;
  return val === 'true' || val === '1';
}

function envInt(key, fallback) {
  const val = env[key];
  if (val === undefined || val === '') return fallback;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? fallback : n;
}

function envStr(key, fallback) {
  const val = env[key];
  return (val !== undefined && val !== '') ? val : fallback;
}


const config = {
  browserPath: envStr('BROWSER_PATH', undefined),
  browserDebugPort: envInt('BROWSER_DEBUG_PORT', 40821),
  browserUserDataDir: envStr('BROWSER_USER_DATA_DIR', undefined),
  browserHeadless: envBool('BROWSER_HEADLESS', false),
  browserProtocolTimeout: envInt('BROWSER_PROTOCOL_TIMEOUT', 60_000),
  outputDir: envStr('OUTPUT_DIR', join(projectRoot, 'gemini-image')),
  daemonPort: envInt('DAEMON_PORT', 40225),
  daemonTTL: envInt('DAEMON_TTL_MS', 30 * 60 * 1000),
  daemonErrorLog: envStr('DAEMON_ERROR_LOG', ''),
};

export default config;
