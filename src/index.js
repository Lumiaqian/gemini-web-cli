/**
 * gemini-web-cli — 统一入口
 *
 * 对外只暴露高层 API，浏览器连接由 Daemon 托管。
 * Daemon 未运行时会自动后台拉起，无需手动启动。
 *
 * 用法：
 *   import { createGeminiSession, disconnect } from './index.js';
 *
 *   const { ops } = await createGeminiSession();
 *   await ops.generateImage('画一只猫');
 *   disconnect();
 */
import { ensureBrowser, disconnect } from './browser.js';
import { createOps } from './gemini-ops.js';

export { disconnect };

/**
 * 创建 Gemini 操控会话
 *
 * 内部通过 Browser Daemon 管理浏览器：
 *   1. 向 Daemon 发送 HTTP 请求获取 wsEndpoint
 *   2. 通过 WebSocket 直连 Chrome CDP
 *   3. 找到 / 新开 Gemini 标签页
 *
 * 浏览器的启动、反爬、生命周期全部由 Daemon 负责，
 * 这里只是一个轻量的 CDP 客户端连接器。
 *
 * @returns {Promise<{ops: ReturnType<typeof createOps>, page: import('puppeteer-core').Page, browser: import('puppeteer-core').Browser}>}
 */
export async function createGeminiSession() {
  const { browser, page } = await ensureBrowser();
  const ops = createOps(page);
  return { ops, page, browser };
}
