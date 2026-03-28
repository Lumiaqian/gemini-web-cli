/**
 * handlers.js — API 路由处理器
 *
 * 端点：
 *   GET  /browser/acquire  — Skill 专用：确保浏览器可用，返回 wsEndpoint
 *   GET  /browser/status   — Agent 探测口：查询浏览器健康状态（不续命）
 *   POST /browser/release  — 主动销毁浏览器（硬重置）
 *   GET  /health           — Daemon 自身健康检查
 */
import { ensureBrowserForDaemon, getBrowser, terminateBrowser } from './engine.js';
import { resetHeartbeat, getLifecycleInfo } from './lifecycle.js';

/**
 * GET /browser/acquire
 *
 * 如果浏览器没启动就冷启动；如果已启动就重置闲置定时器。
 * 返回 wsEndpoint 和 pid，Skill 拿到后可以直接 puppeteer.connect()。
 */
export async function handleAcquire(_req, res) {
  try {
    const browser = await ensureBrowserForDaemon();
    resetHeartbeat();

    const wsEndpoint = browser.wsEndpoint();
    const pid = browser.process()?.pid || null;

    sendJSON(res, 200, {
      ok: true,
      wsEndpoint,
      pid,
      lifecycle: getLifecycleInfo(),
    });
  } catch (err) {
    console.error(`[handler] /browser/acquire 失败: ${err.message}`);
    sendJSON(res, 500, {
      ok: false,
      error: 'acquire_failed',
      detail: err.message,
    });
  }
}

/**
 * GET /browser/status
 *
 * 纯查询，不重置定时器。返回浏览器的健康状态、所有打开页面的信息。
 * Agent 拿到 pages 列表后可以精确定位出错的 Tab 并接管。
 */
export async function handleStatus(_req, res) {
  const browser = getBrowser();

  if (!browser || !browser.isConnected()) {
    sendJSON(res, 200, {
      status: 'offline',
      lifecycle: getLifecycleInfo(),
    });
    return;
  }

  try {
    const targets = browser.targets();
    const pages = targets
      .filter(t => t.type() === 'page')
      .map(t => ({
        targetId: t._targetId,
        url: t.url(),
      }));

    sendJSON(res, 200, {
      status: 'online',
      pid: browser.process()?.pid || null,
      wsEndpoint: browser.wsEndpoint(),
      pages,
      pageCount: pages.length,
      lifecycle: getLifecycleInfo(),
    });
  } catch (err) {
    sendJSON(res, 200, {
      status: 'error',
      error: err.message,
      lifecycle: getLifecycleInfo(),
    });
  }
}

/**
 * POST /browser/release
 *
 * 主动销毁浏览器。用于大版本更新或致命错误后的硬重置。
 */
export async function handleRelease(_req, res) {
  const browser = getBrowser();

  if (!browser) {
    sendJSON(res, 200, { ok: true, message: 'browser_already_offline' });
    return;
  }

  try {
    const pid = browser.process()?.pid || null;
    await terminateBrowser();
    sendJSON(res, 200, { ok: true, message: 'browser_terminated', pid });
  } catch (err) {
    console.error(`[handler] /browser/release 失败: ${err.message}`);
    sendJSON(res, 500, {
      ok: false,
      error: 'release_failed',
      detail: err.message,
    });
  }
}

/**
 * GET /health
 *
 * Daemon 进程自身的健康检查。
 */
export function handleHealth(_req, res) {
  sendJSON(res, 200, {
    ok: true,
    service: 'browser-daemon',
    uptime: Math.round(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
}

// ── 工具函数 ──

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
