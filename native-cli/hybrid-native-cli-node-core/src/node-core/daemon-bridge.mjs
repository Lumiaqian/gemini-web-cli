import config from '../../../../src/config.js';

const DAEMON_ENDPOINTS = ['/health', '/browser/acquire', '/browser/status', '/browser/release'];
const DEFAULT_DAEMON_TIMEOUTS = Object.freeze({
  healthMs: 3_000,
  acquireMs: 5_000,
  statusMs: 5_000,
  releaseMs: 5_000,
});

export const DAEMON_BRIDGE_DESCRIPTOR = Object.freeze({
  bridgeId: 'daemon-api',
  routeId: 'hybrid-native-cli-node-core',
  source: 'src/browser.js',
  daemonStrategy: 'keep',
  daemonBaseUrl: `http://127.0.0.1:${config.daemonPort}`,
  endpoints: DAEMON_ENDPOINTS,
  responsibility: 'Expose daemon-aware browser lifecycle entrypoints behind the native CLI private boundary.',
});

function resolveDaemonBaseUrl(runtime = null) {
  return runtime?.config?.daemonBaseUrl ?? DAEMON_BRIDGE_DESCRIPTOR.daemonBaseUrl;
}

async function requestDaemonJson(endpoint, { runtime = null, method = 'GET', timeoutMs } = {}) {
  const daemonBaseUrl = resolveDaemonBaseUrl(runtime);
  const response = await fetch(`${daemonBaseUrl}${endpoint}`, {
    method,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }

  return response.json();
}

export function getDaemonBaseUrl(runtime = null) {
  return resolveDaemonBaseUrl(runtime);
}

export function describeDaemonBridge(runtime = null) {
  return {
    ...DAEMON_BRIDGE_DESCRIPTOR,
    daemonBaseUrl: resolveDaemonBaseUrl(runtime),
    endpoints: [...DAEMON_BRIDGE_DESCRIPTOR.endpoints],
    timeoutsMs: { ...DEFAULT_DAEMON_TIMEOUTS },
  };
}

export async function fetchDaemonHealth({ runtime = null, timeoutMs = DEFAULT_DAEMON_TIMEOUTS.healthMs } = {}) {
  return requestDaemonJson('/health', { runtime, timeoutMs });
}

export async function fetchDaemonAcquire({ runtime = null, timeoutMs = DEFAULT_DAEMON_TIMEOUTS.acquireMs } = {}) {
  return requestDaemonJson('/browser/acquire', { runtime, timeoutMs });
}

export async function fetchDaemonStatus({ runtime = null, timeoutMs = DEFAULT_DAEMON_TIMEOUTS.statusMs } = {}) {
  return requestDaemonJson('/browser/status', { runtime, timeoutMs });
}

export async function fetchDaemonRelease({ runtime = null, timeoutMs = DEFAULT_DAEMON_TIMEOUTS.releaseMs } = {}) {
  return requestDaemonJson('/browser/release', { runtime, method: 'POST', timeoutMs });
}

export async function acquireBrowserConnection() {
  const { ensureBrowser } = await import('../../../../src/browser.js');
  return ensureBrowser();
}

export async function disconnectBrowserClient() {
  const { disconnect } = await import('../../../../src/browser.js');
  disconnect();
}
