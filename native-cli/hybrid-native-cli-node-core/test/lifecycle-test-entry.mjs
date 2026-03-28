#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createBrowserLifecycleAdapter } from '../src/lifecycle/browser-lifecycle.mjs';
import { CliRuntimeFailure } from '../src/runtime/stdio-runtime.mjs';

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = {
    scenario: 'all',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--scenario') {
      args.scenario = argv[++index] ?? fail('missing value for --scenario');
      continue;
    }

    fail(`unknown argument: ${token}`);
  }

  if (!['all', 'happy', 'stale'].includes(args.scenario)) {
    fail(`unsupported scenario: ${args.scenario}`);
  }

  return args;
}

function createRuntime(overrides = {}) {
  const config = {
    browserPath: null,
    browserPathResolved: null,
    browserDebugPort: 40821,
    browserUserDataDir: null,
    browserHeadless: true,
    browserProtocolTimeout: 60_000,
    outputDir: '/tmp/gemini-image',
    outputDirResolved: '/tmp/gemini-image',
    daemonPort: 40225,
    daemonTTL: 1_800_000,
    daemonBaseUrl: 'http://127.0.0.1:40225',
    timeoutMs: 30_000,
    ...(overrides.config ?? {}),
  };

  return {
    commandId: overrides.commandId ?? 'browser-info',
    jsonMode: true,
    requestId: overrides.requestId ?? 'req_lifecycle_test',
    nonInteractive: true,
    precedence: {
      browserPath: 'default',
      outputDir: 'default',
      timeoutMs: 'default',
      requestId: 'generated',
      nonInteractive: 'env:CI',
      ...(overrides.precedence ?? {}),
    },
    config,
  };
}

function createStdioRecorder() {
  const stderr = [];
  return {
    writeStderr(text) {
      stderr.push(text);
    },
    stderrText() {
      return stderr.join('\n');
    },
  };
}

function createConnectedBrowser(label) {
  let connected = true;
  return {
    label,
    isConnected() {
      return connected;
    },
    disconnectNow() {
      connected = false;
    },
  };
}

async function expectLifecycleFailure(action, expectedReason) {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof CliRuntimeFailure, `expected CliRuntimeFailure, got ${error?.constructor?.name ?? typeof error}`);
    assert.equal(error.category, 'browser-startup-failure');
    if (expectedReason) {
      assert.equal(error.details.reason, expectedReason);
    }
    return error;
  }

  fail(`expected lifecycle failure (${expectedReason ?? 'any'})`);
}

async function verifyBrowserInfoPreservesKeepDaemonSemantics() {
  const calls = [];
  const adapter = createBrowserLifecycleAdapter({
    daemonBridge: {
      describe: (runtime) => ({ daemonBaseUrl: runtime.config.daemonBaseUrl, daemonStrategy: 'keep' }),
      getBaseUrl: (runtime) => runtime.config.daemonBaseUrl,
      async fetchHealth() {
        calls.push('health');
        return { ok: true, service: 'browser-daemon' };
      },
      async acquireBrowser() {
        calls.push('acquire');
        return {
          ok: true,
          wsEndpoint: 'ws://daemon/devtools/browser-1',
          pid: 4321,
          lifecycle: { ttlMs: 1_800_000, remainingSeconds: 1750 },
        };
      },
      async fetchStatus() {
        calls.push('status');
        return {
          status: 'online',
          wsEndpoint: 'ws://daemon/devtools/browser-1',
          pid: 4321,
          pageCount: 1,
          pages: [{ targetId: 'page-1', url: 'https://gemini.google.com/app' }],
          lifecycle: { ttlMs: 1_800_000, remainingSeconds: 1749 },
        };
      },
      async releaseBrowser() {
        calls.push('release');
        return { ok: true, message: 'browser_terminated', pid: 4321 };
      },
    },
    sessionBridge: {
      describe: () => ({ bridgeId: 'session-api' }),
      async openSession() {
        return { browser: createConnectedBrowser('unused'), page: { id: 'page-1' } };
      },
      async closeSession() {},
    },
  });

  const runtime = createRuntime();
  const stdio = createStdioRecorder();
  const result = await adapter.inspectBrowserInfo(runtime, stdio);

  assert.deepEqual(calls, ['health', 'acquire', 'status']);
  assert.equal(result.daemonStrategy, 'keep');
  assert.equal(result.daemon.acquired, true);
  assert.equal(result.daemon.acquireExtendedTtl, true);
  assert.equal(result.browser.wsEndpoint, 'ws://daemon/devtools/browser-1');
  assert.equal(result.lifecycleAdapter.continuity.disconnectKeepsBrowserAlive, true);
  assert.equal(result.lifecycleAdapter.continuity.ttlReusePreserved, true);
  assert.equal(stdio.stderrText(), '');
}

async function verifySessionReuseAndDisconnectKeepBrowserAlive() {
  let openCount = 0;
  let closeCount = 0;
  const browser = createConnectedBrowser('shared-browser');
  const adapter = createBrowserLifecycleAdapter({
    daemonBridge: {
      describe: () => ({ bridgeId: 'daemon-api' }),
      getBaseUrl: () => 'http://127.0.0.1:40225',
      async fetchHealth() { return { ok: true }; },
      async acquireBrowser() { return { ok: true, wsEndpoint: 'ws://unused' }; },
      async fetchStatus() { return { status: 'online', wsEndpoint: 'ws://unused', pages: [], pageCount: 0 }; },
      async releaseBrowser() { return { ok: true, message: 'browser_terminated' }; },
    },
    sessionBridge: {
      describe: () => ({ disconnectKeepsBrowserAlive: true }),
      async openSession() {
        openCount += 1;
        return { browser, page: { id: `page-${openCount}` } };
      },
      async closeSession() {
        closeCount += 1;
      },
    },
  });

  const runtime = createRuntime({ commandId: 'session-new-chat' });
  const first = await adapter.acquireSession(runtime);
  const second = await adapter.acquireSession(runtime);
  const disconnected = await adapter.disconnectSession(runtime);
  const third = await adapter.acquireSession(runtime);

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(first.browser, second.browser);
  assert.equal(openCount, 2);
  assert.equal(closeCount, 1);
  assert.equal(disconnected.disconnected, true);
  assert.equal(disconnected.browserPreserved, true);
  assert.equal(third.reused, false);
}

async function verifyReleaseBrowserUsesDaemonRelease() {
  const order = [];
  const adapter = createBrowserLifecycleAdapter({
    daemonBridge: {
      describe: () => ({ bridgeId: 'daemon-api' }),
      getBaseUrl: () => 'http://127.0.0.1:40225',
      async fetchHealth() { return { ok: true }; },
      async acquireBrowser() { return { ok: true, wsEndpoint: 'ws://unused' }; },
      async fetchStatus() { return { status: 'online', wsEndpoint: 'ws://unused', pages: [], pageCount: 0 }; },
      async releaseBrowser() {
        order.push('release');
        return { ok: true, message: 'browser_terminated', pid: 9911 };
      },
    },
    sessionBridge: {
      describe: () => ({ bridgeId: 'session-api' }),
      async openSession() {
        order.push('open');
        return { browser: createConnectedBrowser('release-browser'), page: { id: 'page-release' } };
      },
      async closeSession() {
        order.push('disconnect');
      },
    },
  });

  const runtime = createRuntime({ commandId: 'image-generate' });
  await adapter.acquireSession(runtime);
  const result = await adapter.releaseBrowser(runtime);

  assert.deepEqual(order, ['open', 'disconnect', 'release']);
  assert.equal(result.ok, true);
  assert.equal(result.message, 'browser_terminated');
  assert.equal(result.daemonStrategy, 'keep');
}

async function verifyStaleSessionIsReplaced() {
  let openCount = 0;
  const firstBrowser = createConnectedBrowser('first');
  const secondBrowser = createConnectedBrowser('second');
  const adapter = createBrowserLifecycleAdapter({
    daemonBridge: {
      describe: () => ({ bridgeId: 'daemon-api' }),
      getBaseUrl: () => 'http://127.0.0.1:40225',
      async fetchHealth() { return { ok: true }; },
      async acquireBrowser() { return { ok: true, wsEndpoint: 'ws://unused' }; },
      async fetchStatus() { return { status: 'online', wsEndpoint: 'ws://unused', pages: [], pageCount: 0 }; },
      async releaseBrowser() { return { ok: true, message: 'browser_terminated' }; },
    },
    sessionBridge: {
      describe: () => ({ bridgeId: 'session-api' }),
      async openSession() {
        openCount += 1;
        if (openCount === 1) {
          return { browser: firstBrowser, page: { id: 'page-1' } };
        }
        return { browser: secondBrowser, page: { id: 'page-2' } };
      },
      async closeSession() {},
    },
  });

  const runtime = createRuntime({ commandId: 'conversation-send-message' });
  const first = await adapter.acquireSession(runtime);
  first.browser.disconnectNow();
  const second = await adapter.acquireSession(runtime);

  assert.equal(first.reused, false);
  assert.equal(second.reused, false);
  assert.equal(second.staleSessionReplaced, true);
  assert.notEqual(first.browser, second.browser);
  assert.equal(openCount, 2);
}

async function verifyOfflineStatusAfterAcquireFailsDeterministically() {
  const adapter = createBrowserLifecycleAdapter({
    daemonBridge: {
      describe: () => ({ bridgeId: 'daemon-api' }),
      getBaseUrl: () => 'http://127.0.0.1:40225',
      async fetchHealth() {
        return { ok: true };
      },
      async acquireBrowser() {
        return { ok: true, wsEndpoint: 'ws://daemon/stale', pid: 1001 };
      },
      async fetchStatus() {
        return { status: 'offline', lifecycle: { ttlMs: 1234 } };
      },
      async releaseBrowser() {
        return { ok: true, message: 'browser_terminated' };
      },
    },
    sessionBridge: {
      describe: () => ({ bridgeId: 'session-api' }),
      async openSession() {
        return { browser: createConnectedBrowser('unused'), page: { id: 'page-1' } };
      },
      async closeSession() {},
    },
  });

  const runtime = createRuntime();
  const stdio = createStdioRecorder();
  const error = await expectLifecycleFailure(() => adapter.inspectBrowserInfo(runtime, stdio), 'stale-daemon-state');

  assert.equal(error.details.phase, 'status');
  assert.match(stdio.stderrText(), /daemon status validation failed/i);
}

async function verifyMissingAcquireWsEndpointFailsDeterministically() {
  const adapter = createBrowserLifecycleAdapter({
    daemonBridge: {
      describe: () => ({ bridgeId: 'daemon-api' }),
      getBaseUrl: () => 'http://127.0.0.1:40225',
      async fetchHealth() {
        return { ok: true };
      },
      async acquireBrowser() {
        return { ok: true, pid: 1002 };
      },
      async fetchStatus() {
        return { status: 'online', pageCount: 0, pages: [] };
      },
      async releaseBrowser() {
        return { ok: true, message: 'browser_terminated' };
      },
    },
    sessionBridge: {
      describe: () => ({ bridgeId: 'session-api' }),
      async openSession() {
        return { browser: createConnectedBrowser('unused'), page: { id: 'page-1' } };
      },
      async closeSession() {},
    },
  });

  const runtime = createRuntime();
  const stdio = createStdioRecorder();
  const error = await expectLifecycleFailure(() => adapter.inspectBrowserInfo(runtime, stdio), 'stale-daemon-state');

  assert.equal(error.details.phase, 'acquire');
  assert.match(stdio.stderrText(), /daemon acquire failed/i);
}

async function verifyBoundedTimedDaemonFailure() {
  const adapter = createBrowserLifecycleAdapter({
    daemonBridge: {
      describe: () => ({ bridgeId: 'daemon-api' }),
      getBaseUrl: () => 'http://127.0.0.1:40225',
      async fetchHealth() {
        return { ok: true };
      },
      async acquireBrowser() {
        return { ok: true, wsEndpoint: 'ws://daemon/timeout', pid: 1003 };
      },
      async fetchStatus() {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('status probe timed out')), 25);
        });
      },
      async releaseBrowser() {
        return { ok: true, message: 'browser_terminated' };
      },
    },
    sessionBridge: {
      describe: () => ({ bridgeId: 'session-api' }),
      async openSession() {
        return { browser: createConnectedBrowser('unused'), page: { id: 'page-1' } };
      },
      async closeSession() {},
    },
  });

  const runtime = createRuntime();
  const stdio = createStdioRecorder();
  const startedAt = Date.now();
  const error = await expectLifecycleFailure(() => adapter.inspectBrowserInfo(runtime, stdio), 'status-failed');
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs < 1_000, `expected bounded lifecycle failure, got ${elapsedMs}ms`);
  assert.equal(error.details.phase, 'status');
  assert.match(stdio.stderrText(), /status probe timed out/);
}

const SCENARIOS = {
  happy: [
    { id: 'browser-info-keep-daemon', run: verifyBrowserInfoPreservesKeepDaemonSemantics },
    { id: 'session-reuse-disconnect', run: verifySessionReuseAndDisconnectKeepBrowserAlive },
    { id: 'release-browser', run: verifyReleaseBrowserUsesDaemonRelease },
  ],
  stale: [
    { id: 'stale-session-replaced', run: verifyStaleSessionIsReplaced },
    { id: 'offline-after-acquire', run: verifyOfflineStatusAfterAcquireFailsDeterministically },
    { id: 'missing-acquire-endpoint', run: verifyMissingAcquireWsEndpointFailsDeterministically },
    { id: 'bounded-status-timeout', run: verifyBoundedTimedDaemonFailure },
  ],
};

function selectChecks(scenario) {
  if (scenario === 'all') {
    return [...SCENARIOS.happy, ...SCENARIOS.stale];
  }
  return SCENARIOS[scenario];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const checks = selectChecks(args.scenario);

  for (const check of checks) {
    await check.run();
  }

  process.stdout.write(`OK lifecycle-test-entry scenario=${args.scenario} checks=${checks.length}\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
});
