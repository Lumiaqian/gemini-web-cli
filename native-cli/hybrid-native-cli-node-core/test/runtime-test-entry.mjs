#!/usr/bin/env node

import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { dispatchHybridNativeCliCommand } from '../src/shell/dispatch-command.mjs';
import { createStdioRuntime } from '../src/runtime/stdio-runtime.mjs';
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

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

async function runJsonCommand(argv) {
  const stdout = createBufferStream();
  const stderr = createBufferStream();
  const exitCode = await dispatchHybridNativeCliCommand(argv, {
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  return {
    exitCode,
    stdout: stdout.read(),
    stderr: stderr.read(),
    envelope: JSON.parse(stdout.read()),
  };
}

async function verifyOutputDirPrecedence() {
  const result = await withEnv(
    {
      OUTPUT_DIR: '/tmp/from-env',
      BROWSER_PATH: null,
      DAEMON_PORT: '9',
    },
    () => runJsonCommand(['browser-info', '--json', '--output-dir', '/tmp/from-flag'])
  );

  assert.equal(result.envelope.error.details.runtime.config.outputDir, '/tmp/from-flag');
  assert.equal(result.envelope.error.details.runtime.precedence.outputDir, 'flag:--output-dir');
}

async function verifyBrowserPathFailure() {
  const result = await withEnv(
    {
      BROWSER_PATH: '/nonexistent/runtime-test-browser',
    },
    () => runJsonCommand(['browser-info', '--json'])
  );

  assert.equal(result.exitCode, getExitCodeForCategory('browser-startup-failure'));
  assert.equal(result.envelope.error.category, 'browser-startup-failure');
  assert.match(result.stderr, /Configured browser path does not exist/);
}

async function verifyMachineStdoutGuard() {
  const stdout = createBufferStream();
  const stderr = createBufferStream();
  const runtime = createStdioRuntime({
    stdout: stdout.stream,
    stderr: stderr.stream,
    jsonMode: true,
  });

  await runtime.runCommand(() => {
    console.log('guarded stdout');
    return 'ok';
  }, { timeoutMs: null });

  assert.equal(stdout.read(), '');
  assert.match(stderr.read(), /guarded stdout/);
}

async function main() {
  await verifyOutputDirPrecedence();
  await verifyBrowserPathFailure();
  await verifyMachineStdoutGuard();
  process.stdout.write('OK runtime-test-entry\n');
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
});
