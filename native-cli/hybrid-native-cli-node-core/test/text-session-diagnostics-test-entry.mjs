#!/usr/bin/env node

import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { dispatchHybridNativeCliCommand } from '../src/shell/dispatch-command.mjs';
import { getExitCodeForCategory } from '../src/runtime/exit-codes.mjs';

function createBufferStream() {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });

  return {
    stream,
    read() {
      return text;
    },
  };
}

async function runJsonCommand(argv, dependencies) {
  const stdout = createBufferStream();
  const stderr = createBufferStream();
  const exitCode = await dispatchHybridNativeCliCommand(argv, {
    stdout: stdout.stream,
    stderr: stderr.stream,
    dependencies,
  });

  return {
    exitCode,
    stdout: stdout.read(),
    stderr: stderr.read(),
    envelope: JSON.parse(stdout.read()),
  };
}

function createRuntimeLikeSnapshot(commandId) {
  return {
    commandId,
    requestId: `req_test_${commandId}`,
    jsonMode: true,
    nonInteractive: false,
    precedence: {
      browserPath: 'default',
      outputDir: 'default',
      timeoutMs: 'flag:--timeout-ms',
      requestId: 'generated',
      nonInteractive: 'default',
    },
    config: {
      browserPath: null,
      browserPathResolved: null,
      browserDebugPort: 40821,
      browserHeadless: false,
      browserProtocolTimeout: 60_000,
      browserUserDataDir: null,
      outputDir: '/tmp/gemini-image',
      outputDirResolved: '/tmp/gemini-image',
      daemonPort: 40225,
      daemonTTL: 1_800_000,
      daemonBaseUrl: 'http://127.0.0.1:40225',
      timeoutMs: 15_000,
    },
  };
}

function createHappyPathDependencies() {
  const calls = [];
  const allResponses = [
    { index: 0, text: 'Hello from Gemini.' },
    { index: 1, text: 'Reply: Integration hello' },
  ];

  const ops = {
    async click(key) {
      calls.push(`click:${key}`);
      return { ok: true };
    },
    async clickTempChat() {
      calls.push('temp-chat');
      return { ok: true };
    },
    async switchToModel(model) {
      calls.push(`switch-model:${model}`);
      return { ok: true, previousModel: 'Pro' };
    },
    async sendAndWait(message, { timeout }) {
      calls.push(`send:${message}:${timeout}`);
      return {
        ok: true,
        text: `Reply: ${message}`,
        textIndex: 1,
        elapsed: 321,
        finalStatus: { status: 'mic', pageVisible: true },
      };
    },
    async getAllTextResponses() {
      calls.push('get-all-text-responses');
      return { ok: true, responses: allResponses, total: allResponses.length };
    },
    async getLatestTextResponse() {
      calls.push('get-latest-text-response');
      return { ok: true, text: allResponses[1].text, index: 1 };
    },
    async checkLogin() {
      calls.push('check-login');
      return { ok: true, loggedIn: true, barText: 'Profile Menu' };
    },
    async probe() {
      calls.push('probe');
      return {
        promptInput: true,
        actionBtnWrapper: true,
        newChatBtn: true,
        modelBtn: true,
        modelLabel: true,
        tempChatBtn: true,
        currentModel: 'Pro',
        status: { status: 'mic', btnClass: 'submit' },
      };
    },
    async reloadPage({ timeout }) {
      calls.push(`reload:${timeout}`);
      return { ok: true, elapsed: 42 };
    },
    async navigateTo(url, { timeout }) {
      calls.push(`navigate:${url}:${timeout}`);
      return { ok: true, url, elapsed: 84 };
    },
  };

  const browserLifecycle = {
    async acquireSession(runtime) {
      calls.push(`acquire:${runtime.commandId}`);
      return {
        ops,
        reused: false,
        staleSessionReplaced: false,
        daemonStrategy: 'keep',
      };
    },
    async disconnectSession(runtime) {
      calls.push(`disconnect:${runtime.commandId}`);
      return {
        disconnected: true,
        browserPreserved: true,
        daemonStrategy: 'keep',
      };
    },
    async inspectBrowserInfo(runtime) {
      calls.push(`browser-info:${runtime.commandId}`);
      return {
        routeId: 'hybrid-native-cli-node-core',
        scaffoldVersion: 1,
        daemonStrategy: 'keep',
        commandId: 'browser-info',
        runtime: createRuntimeLikeSnapshot(runtime.commandId),
        lifecycleAdapter: {
          adapterId: 'browser-lifecycle',
          continuity: {
            browserInfoUsesAcquire: true,
            ttlReusePreserved: true,
            disconnectKeepsBrowserAlive: true,
            daemonRemainsPrivateBoundary: true,
          },
        },
        daemon: {
          url: 'http://127.0.0.1:40225',
          port: 40225,
          status: 'online',
          acquired: true,
          acquireExtendedTtl: true,
        },
        browser: {
          cdpPort: 40821,
          wsEndpoint: 'ws://daemon/devtools/browser-test',
          pid: 777,
          pageCount: 1,
          pages: [{ url: 'https://gemini.google.com/app' }],
        },
      };
    },
  };

  return { dependencies: { browserLifecycle }, calls };
}

function createTimeoutDependencies() {
  const calls = [];
  const browserLifecycle = {
    async acquireSession(runtime) {
      calls.push(`acquire:${runtime.commandId}`);
      return {
        ops: {
          async sendAndWait(message, { timeout }) {
            calls.push(`send-timeout:${message}:${timeout}`);
            return {
              ok: false,
              error: 'timeout',
              elapsed: timeout,
              finalStatus: { status: 'stop', btnClass: 'stop' },
            };
          },
        },
        reused: false,
        staleSessionReplaced: false,
        daemonStrategy: 'keep',
      };
    },
    async disconnectSession(runtime) {
      calls.push(`disconnect:${runtime.commandId}`);
    },
    async inspectBrowserInfo() {
      throw new Error('inspectBrowserInfo should not run in timeout scenario');
    },
  };

  return { dependencies: { browserLifecycle }, calls };
}

async function verifyHappyPathFlow() {
  const { dependencies, calls } = createHappyPathDependencies();

  const newChat = await runJsonCommand(['new-chat', '--json', '--timeout-ms', '15000'], dependencies);
  assert.equal(newChat.exitCode, 0);
  assert.equal(newChat.envelope.ok, true);
  assert.equal(newChat.envelope.result.commandId, 'new-chat');

  const sendMessage = await runJsonCommand([
    'send-message',
    '--json',
    '--timeout-ms', '15000',
    '--message', 'Integration hello',
  ], dependencies);
  assert.equal(sendMessage.exitCode, 0);
  assert.equal(sendMessage.envelope.result.text, 'Reply: Integration hello');
  assert.equal(sendMessage.envelope.result.responseIndex, 1);

  const latest = await runJsonCommand(['get-latest-text-response', '--json', '--timeout-ms', '15000'], dependencies);
  assert.equal(latest.exitCode, 0);
  assert.equal(latest.envelope.result.text, 'Reply: Integration hello');

  const allResponses = await runJsonCommand(['get-all-text-responses', '--json', '--timeout-ms', '15000'], dependencies);
  assert.equal(allResponses.exitCode, 0);
  assert.equal(allResponses.envelope.result.total, 2);

  const probe = await runJsonCommand(['probe', '--json', '--timeout-ms', '15000'], dependencies);
  assert.equal(probe.exitCode, 0);
  assert.equal(probe.envelope.result.pageStatus.status, 'mic');

  const browserInfo = await runJsonCommand(['browser-info', '--json', '--timeout-ms', '15000'], dependencies);
  assert.equal(browserInfo.exitCode, 0);
  assert.equal(browserInfo.envelope.result.daemonStrategy, 'keep');
  assert.equal(browserInfo.envelope.result.lifecycleAdapter.continuity.disconnectKeepsBrowserAlive, true);
  assert.equal(browserInfo.envelope.result.browser.wsEndpoint, 'ws://daemon/devtools/browser-test');

  const navigate = await runJsonCommand([
    'navigate',
    '--json',
    '--timeout-ms', '15000',
    '--url', 'https://gemini.google.com/app/session-123',
  ], dependencies);
  assert.equal(navigate.exitCode, 0);
  assert.equal(navigate.envelope.result.url, 'https://gemini.google.com/app/session-123');

  assert.match(calls.join('\n'), /browser-info:browser-info/);
  assert.ok(!calls.includes('acquire:browser-info'), 'browser-info should stay on lifecycle inspect path');
  assert.match(calls.join('\n'), /send:Integration hello:15000/);
}

async function verifyTimeoutFailureCoverage() {
  const { dependencies, calls } = createTimeoutDependencies();
  const result = await runJsonCommand([
    'send-message',
    '--json',
    '--timeout-ms', '9000',
    '--message', 'Trigger timeout',
  ], dependencies);

  assert.equal(result.exitCode, getExitCodeForCategory('timeout'));
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.execution.terminalState, 'timed_out');
  assert.equal(result.envelope.error.category, 'timeout');
  assert.equal(result.envelope.error.details.reason, 'wait-for-response-timeout');
  assert.equal(result.envelope.error.details.elapsedMs, 9000);
  assert.deepEqual(calls, ['acquire:send-message', 'send-timeout:Trigger timeout:9000', 'disconnect:send-message']);
}

async function verifyInvalidNavigateDomainFailure() {
  const { dependencies, calls } = createHappyPathDependencies();
  const result = await runJsonCommand([
    'navigate',
    '--json',
    '--timeout-ms', '15000',
    '--url', 'https://not-gemini.example.com/session',
  ], dependencies);

  assert.equal(result.exitCode, getExitCodeForCategory('invalid-args'));
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.error.category, 'invalid-args');
  assert.equal(result.envelope.error.details.reason, 'invalid-domain');
  assert.equal(result.envelope.error.details.hostname, 'not-gemini.example.com');
  assert.equal(calls.length, 0, 'domain rejection should happen before any lifecycle/session call');
}

async function main() {
  await verifyHappyPathFlow();
  await verifyTimeoutFailureCoverage();
  await verifyInvalidNavigateDomainFailure();
  process.stdout.write('OK text-session-diagnostics-test-entry\n');
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
});
