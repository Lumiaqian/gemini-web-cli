import { ROUTE_ID, SCAFFOLD_VERSION } from '../route-metadata.mjs';
import { toPublicRuntimeSnapshot } from '../runtime/load-cli-config.mjs';
import { CliRuntimeFailure } from '../runtime/stdio-runtime.mjs';
import {
  describeDaemonBridge,
  fetchDaemonAcquire,
  fetchDaemonHealth,
  fetchDaemonRelease,
  fetchDaemonStatus,
  getDaemonBaseUrl,
} from '../node-core/daemon-bridge.mjs';
import {
  describeSessionBridge,
  openGeminiSession,
  closeGeminiSession,
} from '../node-core/session-bridge.mjs';

export const LIFECYCLE_TIMEOUTS_MS = Object.freeze({
  health: 3_000,
  acquire: 5_000,
  status: 5_000,
  release: 5_000,
});

function buildRuntimeSnapshot(runtime) {
  return runtime ? toPublicRuntimeSnapshot(runtime) : null;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function throwLifecycleFailure({
  runtime,
  phase,
  reason,
  message,
  cause = null,
  details = null,
  category = 'browser-startup-failure',
}) {
  throw new CliRuntimeFailure({
    category,
    message,
    details: {
      reason,
      phase,
      cause,
      runtime: buildRuntimeSnapshot(runtime),
      ...(details ?? {}),
    },
  });
}

function ensureAcquirePayload(payload, runtime) {
  if (!payload || typeof payload !== 'object') {
    throwLifecycleFailure({
      runtime,
      phase: 'acquire',
      reason: 'stale-daemon-state',
      message: 'Daemon returned an invalid acquire payload.',
      details: { payload },
    });
  }

  if (payload.ok !== true) {
    throwLifecycleFailure({
      runtime,
      phase: 'acquire',
      reason: payload.error ?? 'acquire-failed',
      message: payload.detail
        ? `Daemon could not acquire a browser session: ${payload.detail}`
        : 'Daemon could not acquire a browser session.',
      details: { payload },
    });
  }

  if (!isNonEmptyString(payload.wsEndpoint)) {
    throwLifecycleFailure({
      runtime,
      phase: 'acquire',
      reason: 'stale-daemon-state',
      message: 'Daemon returned an acquire response without a WebSocket endpoint.',
      details: { payload },
    });
  }

  return payload;
}

function normalizeStatusPayload(statusPayload, acquirePayload, runtime) {
  if (!statusPayload || typeof statusPayload !== 'object') {
    throwLifecycleFailure({
      runtime,
      phase: 'status',
      reason: 'stale-daemon-state',
      message: 'Daemon returned an invalid browser status payload.',
      details: { statusPayload },
    });
  }

  if (statusPayload.status === 'error') {
    throwLifecycleFailure({
      runtime,
      phase: 'status',
      reason: 'stale-daemon-state',
      message: 'Daemon reported an errored browser state after acquire.',
      details: { statusPayload },
      cause: statusPayload.error ?? null,
    });
  }

  if (statusPayload.status === 'offline') {
    throwLifecycleFailure({
      runtime,
      phase: 'status',
      reason: 'stale-daemon-state',
      message: 'Daemon reported the browser as offline immediately after acquire.',
      details: { statusPayload, acquirePayload },
    });
  }

  const wsEndpoint = isNonEmptyString(statusPayload.wsEndpoint)
    ? statusPayload.wsEndpoint
    : acquirePayload.wsEndpoint;

  if (!isNonEmptyString(wsEndpoint)) {
    throwLifecycleFailure({
      runtime,
      phase: 'status',
      reason: 'stale-daemon-state',
      message: 'Daemon status did not include a reusable browser WebSocket endpoint.',
      details: { statusPayload, acquirePayload },
    });
  }

  return {
    status: statusPayload.status ?? 'unknown',
    pid: statusPayload.pid ?? acquirePayload.pid ?? null,
    wsEndpoint,
    pageCount: Number.isInteger(statusPayload.pageCount) ? statusPayload.pageCount : 0,
    pages: Array.isArray(statusPayload.pages) ? statusPayload.pages : [],
    lifecycle: statusPayload.lifecycle ?? acquirePayload.lifecycle ?? null,
  };
}

function validateSessionPayload(session, runtime, staleSessionReplaced) {
  const browser = session?.browser ?? null;
  const page = session?.page ?? null;

  if (!browser || typeof browser.isConnected !== 'function') {
    throwLifecycleFailure({
      runtime,
      phase: 'session-open',
      reason: 'invalid-session-bridge-result',
      message: 'Session bridge did not return a browser connection handle.',
      details: { staleSessionReplaced },
    });
  }

  if (!browser.isConnected()) {
    throwLifecycleFailure({
      runtime,
      phase: 'session-open',
      reason: 'stale-session-state',
      message: 'Session bridge returned a disconnected browser handle.',
      details: { staleSessionReplaced },
    });
  }

  if (!page) {
    throwLifecycleFailure({
      runtime,
      phase: 'session-open',
      reason: 'stale-session-state',
      message: 'Session bridge returned a browser session without an active page.',
      details: { staleSessionReplaced },
    });
  }

  return session;
}

function hasReusableSession(activeSession) {
  const browser = activeSession?.browser ?? null;
  return Boolean(browser && typeof browser.isConnected === 'function' && browser.isConnected());
}

export function describeBrowserLifecycleModel(runtime = null) {
  return {
    adapterId: 'browser-lifecycle',
    routeId: ROUTE_ID,
    scaffoldVersion: SCAFFOLD_VERSION,
    daemonStrategy: 'keep',
    daemonBaseUrl: getDaemonBaseUrl(runtime),
    continuity: {
      browserInfoUsesAcquire: true,
      ttlReusePreserved: true,
      disconnectKeepsBrowserAlive: true,
      daemonRemainsPrivateBoundary: true,
    },
    staleStateProtection: [
      'health-timeout',
      'acquire-payload-validation',
      'status-payload-validation',
      'stale-session-reconnect',
    ],
    timeoutBudgetMs: { ...LIFECYCLE_TIMEOUTS_MS },
  };
}

export function createBrowserLifecycleAdapter({ daemonBridge, sessionBridge } = {}) {
  const daemon = daemonBridge ?? {
    describe: (runtime = null) => describeDaemonBridge(runtime),
    getBaseUrl: (runtime = null) => getDaemonBaseUrl(runtime),
    fetchHealth: ({ runtime = null, timeoutMs = LIFECYCLE_TIMEOUTS_MS.health } = {}) => fetchDaemonHealth({ runtime, timeoutMs }),
    acquireBrowser: ({ runtime = null, timeoutMs = LIFECYCLE_TIMEOUTS_MS.acquire } = {}) => fetchDaemonAcquire({ runtime, timeoutMs }),
    fetchStatus: ({ runtime = null, timeoutMs = LIFECYCLE_TIMEOUTS_MS.status } = {}) => fetchDaemonStatus({ runtime, timeoutMs }),
    releaseBrowser: ({ runtime = null, timeoutMs = LIFECYCLE_TIMEOUTS_MS.release } = {}) => fetchDaemonRelease({ runtime, timeoutMs }),
  };

  const sessions = sessionBridge ?? {
    describe: () => describeSessionBridge(),
    openSession: () => openGeminiSession(),
    closeSession: () => closeGeminiSession(),
  };

  let activeSession = null;

  async function inspectBrowserInfo(runtime, stdioRuntime) {
    const daemonUrl = daemon.getBaseUrl(runtime);
    let health;

    try {
      health = await daemon.fetchHealth({ runtime, timeoutMs: LIFECYCLE_TIMEOUTS_MS.health });
    } catch (error) {
      stdioRuntime.writeStderr(`[lifecycle] daemon health probe failed for ${daemonUrl}: ${toErrorMessage(error)}`);
      throwLifecycleFailure({
        runtime,
        phase: 'health',
        reason: 'daemon-unreachable',
        message: `Unable to reach daemon health endpoint at ${daemonUrl}.`,
        cause: toErrorMessage(error),
        details: { daemonUrl },
      });
    }

    if (health?.ok !== true) {
      stdioRuntime.writeStderr(`[lifecycle] daemon at ${daemonUrl} reported not ready.`);
      throwLifecycleFailure({
        runtime,
        phase: 'health',
        reason: 'daemon-not-ready',
        message: `Daemon is not ready at ${daemonUrl}.`,
        details: { daemonUrl, health },
      });
    }

    let acquirePayload;
    try {
      acquirePayload = ensureAcquirePayload(
        await daemon.acquireBrowser({ runtime, timeoutMs: LIFECYCLE_TIMEOUTS_MS.acquire }),
        runtime,
      );
    } catch (error) {
      if (error instanceof CliRuntimeFailure) {
        stdioRuntime.writeStderr(`[lifecycle] daemon acquire failed for ${daemonUrl}: ${error.message}`);
        throw error;
      }
      stdioRuntime.writeStderr(`[lifecycle] daemon acquire failed for ${daemonUrl}: ${toErrorMessage(error)}`);
      throwLifecycleFailure({
        runtime,
        phase: 'acquire',
        reason: 'acquire-failed',
        message: `Unable to acquire browser state from ${daemonUrl}.`,
        cause: toErrorMessage(error),
        details: { daemonUrl },
      });
    }

    let statusPayload;
    try {
      statusPayload = normalizeStatusPayload(
        await daemon.fetchStatus({ runtime, timeoutMs: LIFECYCLE_TIMEOUTS_MS.status }),
        acquirePayload,
        runtime,
      );
    } catch (error) {
      if (error instanceof CliRuntimeFailure) {
        stdioRuntime.writeStderr(`[lifecycle] daemon status validation failed for ${daemonUrl}: ${error.message}`);
        throw error;
      }
      stdioRuntime.writeStderr(`[lifecycle] daemon status query failed for ${daemonUrl}: ${toErrorMessage(error)}`);
      throwLifecycleFailure({
        runtime,
        phase: 'status',
        reason: 'status-failed',
        message: `Unable to query browser status from ${daemonUrl}.`,
        cause: toErrorMessage(error),
        details: { daemonUrl },
      });
    }

    return {
      routeId: ROUTE_ID,
      scaffoldVersion: SCAFFOLD_VERSION,
      daemonStrategy: 'keep',
      commandId: 'browser-info',
      runtime: buildRuntimeSnapshot(runtime),
      lifecycleAdapter: {
        ...describeBrowserLifecycleModel(runtime),
        daemonBridge: daemon.describe(runtime),
        sessionBridge: sessions.describe(),
      },
      daemon: {
        url: daemonUrl,
        port: runtime.config.daemonPort,
        health,
        status: statusPayload.status,
        lifecycle: statusPayload.lifecycle,
        acquired: true,
        acquireExtendedTtl: true,
      },
      browser: {
        cdpPort: runtime.config.browserDebugPort,
        headless: runtime.config.browserHeadless,
        protocolTimeout: runtime.config.browserProtocolTimeout,
        wsEndpoint: statusPayload.wsEndpoint,
        pid: statusPayload.pid,
        pageCount: statusPayload.pageCount,
        pages: statusPayload.pages,
      },
    };
  }

  async function acquireSession(runtime) {
    if (hasReusableSession(activeSession)) {
      return {
        ...activeSession,
        reused: true,
        staleSessionReplaced: false,
        daemonStrategy: 'keep',
        lifecycleAdapter: describeBrowserLifecycleModel(runtime),
      };
    }

    const staleSessionReplaced = activeSession !== null;
    activeSession = null;

    let session;
    try {
      session = validateSessionPayload(await sessions.openSession({ runtime }), runtime, staleSessionReplaced);
    } catch (error) {
      if (error instanceof CliRuntimeFailure) {
        throw error;
      }
      throwLifecycleFailure({
        runtime,
        phase: 'session-open',
        reason: 'session-open-failed',
        message: 'Unable to open a Gemini browser session through the Node core bridge.',
        cause: toErrorMessage(error),
        details: { staleSessionReplaced },
      });
    }

    activeSession = session;
    return {
      ...session,
      reused: false,
      staleSessionReplaced,
      daemonStrategy: 'keep',
      lifecycleAdapter: describeBrowserLifecycleModel(runtime),
    };
  }

  async function disconnectSession(runtime) {
    const hadActiveSession = activeSession !== null;
    activeSession = null;

    if (!hadActiveSession) {
      return {
        disconnected: false,
        browserPreserved: true,
        daemonStrategy: 'keep',
        lifecycleAdapter: describeBrowserLifecycleModel(runtime),
      };
    }

    try {
      await sessions.closeSession({ runtime });
    } catch (error) {
      throwLifecycleFailure({
        runtime,
        phase: 'session-disconnect',
        reason: 'disconnect-failed',
        message: 'Unable to disconnect the active Gemini browser session cleanly.',
        cause: toErrorMessage(error),
      });
    }

    return {
      disconnected: true,
      browserPreserved: true,
      daemonStrategy: 'keep',
      lifecycleAdapter: describeBrowserLifecycleModel(runtime),
    };
  }

  async function releaseBrowser(runtime) {
    await disconnectSession(runtime);

    let payload;
    try {
      payload = await daemon.releaseBrowser({ runtime, timeoutMs: LIFECYCLE_TIMEOUTS_MS.release });
    } catch (error) {
      throwLifecycleFailure({
        runtime,
        phase: 'release',
        reason: 'release-failed',
        message: `Unable to release the daemon-owned browser at ${daemon.getBaseUrl(runtime)}.`,
        cause: toErrorMessage(error),
      });
    }

    if (!payload || typeof payload !== 'object' || payload.ok !== true) {
      throwLifecycleFailure({
        runtime,
        phase: 'release',
        reason: payload?.error ?? 'release-failed',
        message: 'Daemon rejected the browser release request.',
        details: { payload },
      });
    }

    return {
      ...payload,
      daemonStrategy: 'keep',
      lifecycleAdapter: describeBrowserLifecycleModel(runtime),
    };
  }

  return Object.freeze({
    describeModel: (runtime = null) => ({
      ...describeBrowserLifecycleModel(runtime),
      daemonBridge: daemon.describe(runtime),
      sessionBridge: sessions.describe(),
    }),
    inspectBrowserInfo,
    acquireSession,
    disconnectSession,
    releaseBrowser,
  });
}
