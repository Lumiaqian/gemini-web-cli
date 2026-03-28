#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..');

const srcPath = join(projectRoot, 'src');

const EXIT_CODES = {
  SUCCESS: 0,
  INVALID_ARGS: 2,
  AUTH_FAILURE: 3,
  BROWSER_STARTUP_FAILURE: 4,
  SELECTOR_FAILURE: 5,
  TIMEOUT: 6,
  INTERRUPTED: 7,
  INTERNAL_ERROR: 8,
};

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
    console.error(`    Expected: ${expected}`);
    console.error(`    Actual: ${actual}`);
  }
}

function assertTrue(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

async function runTests() {
  console.log('\n=== errors.js Tests ===');

  const errors = await import(join(srcPath, 'errors.js'));

  console.log('\n  EXIT_CODES:');
  assertEqual(errors.EXIT_CODES.SUCCESS, 0, 'SUCCESS is 0');
  assertEqual(errors.EXIT_CODES.INVALID_ARGS, 2, 'INVALID_ARGS is 2');
  assertEqual(errors.EXIT_CODES.AUTH_FAILURE, 3, 'AUTH_FAILURE is 3');
  assertEqual(errors.EXIT_CODES.BROWSER_STARTUP_FAILURE, 4, 'BROWSER_STARTUP_FAILURE is 4');
  assertEqual(errors.EXIT_CODES.SELECTOR_FAILURE, 5, 'SELECTOR_FAILURE is 5');
  assertEqual(errors.EXIT_CODES.TIMEOUT, 6, 'TIMEOUT is 6');
  assertEqual(errors.EXIT_CODES.INTERRUPTED, 7, 'INTERRUPTED is 7');
  assertEqual(errors.EXIT_CODES.INTERNAL_ERROR, 8, 'INTERNAL_ERROR is 8');

  console.log('\n  ERROR_CODES:');
  assertEqual(errors.ERROR_CODES.ELEMENT_NOT_FOUND, 'element_not_found', 'ELEMENT_NOT_FOUND');
  assertEqual(errors.ERROR_CODES.TIMEOUT, 'timeout', 'TIMEOUT');
  assertEqual(errors.ERROR_CODES.INVALID_ARGS, 'invalid_args', 'INVALID_ARGS');
  assertEqual(errors.ERROR_CODES.AUTH_FAILURE, 'auth_failure', 'AUTH_FAILURE');
  assertEqual(errors.ERROR_CODES.BROWSER_STARTUP_FAILURE, 'browser_startup_failure', 'BROWSER_STARTUP_FAILURE');
  assertEqual(errors.ERROR_CODES.SELECTOR_FAILURE, 'selector_failure', 'SELECTOR_FAILURE');
  assertEqual(errors.ERROR_CODES.INTERNAL_ERROR, 'internal_error', 'INTERNAL_ERROR');

  console.log('\n  errorCodeToExitCode():');
  assertEqual(errors.errorCodeToExitCode('invalid_args'), EXIT_CODES.INVALID_ARGS, 'invalid_args -> 2');
  assertEqual(errors.errorCodeToExitCode('timeout'), EXIT_CODES.TIMEOUT, 'timeout -> 6');
  assertEqual(errors.errorCodeToExitCode('unknown_error_code'), EXIT_CODES.INTERNAL_ERROR, 'unknown -> 8 (default)');

  console.log('\n  OperationalError:');
  const opErr = new errors.OperationalError('test message', { code: 'TEST', exitCode: 1 });
  assertTrue(opErr instanceof Error, 'instanceof Error');
  assertTrue(opErr instanceof errors.OperationalError, 'instanceof OperationalError');
  assertEqual(opErr.message, 'test message', 'message preserved');
  assertEqual(opErr.code, 'TEST', 'code preserved');
  assertEqual(opErr.exitCode, 1, 'exitCode preserved');
  assertTrue(typeof opErr.toJSON === 'function', 'has toJSON method');

  console.log('\n  BrowserNotFoundError:');
  const bnfErr = new errors.BrowserNotFoundError();
  assertEqual(bnfErr.name, 'BrowserNotFoundError', 'name is BrowserNotFoundError');
  assertEqual(bnfErr.code, 'BROWSER_NOT_FOUND', 'code is BROWSER_NOT_FOUND');
  assertEqual(bnfErr.exitCode, EXIT_CODES.BROWSER_STARTUP_FAILURE, 'exitCode is BROWSER_STARTUP_FAILURE');

  console.log('\n  DaemonStartupError:');
  const dsErr = new errors.DaemonStartupError('custom message');
  assertEqual(dsErr.name, 'DaemonStartupError', 'name is DaemonStartupError');
  assertEqual(dsErr.message, 'custom message', 'custom message preserved');

  console.log('\n  isOperationalError():');
  assertTrue(errors.isOperationalError(opErr), 'OperationalError returns true');
  assertTrue(!errors.isOperationalError(new Error('plain')), 'plain Error returns false');
  assertTrue(!errors.isOperationalError('string'), 'string returns false');

  console.log('\n  getErrorCode():');
  assertEqual(errors.getErrorCode('element_not_found'), 'element_not_found', 'string passes through');
  assertEqual(errors.getErrorCode(opErr), 'TEST', 'OperationalError returns code');
  assertEqual(errors.getErrorCode(new Error('msg')), 'msg', 'plain Error returns message');
  assertEqual(errors.getErrorCode(null), 'null', 'null becomes string');

  console.log('\n=== util.js Tests ===');

  const { sleep } = await import(join(srcPath, 'util.js'));

  const start = performance.now();
  await sleep(50);
  const elapsed = performance.now() - start;
  assertTrue(elapsed >= 45 && elapsed < 150, `sleep(50) took ${elapsed.toFixed(0)}ms (expected ~50ms)`);

  console.log('\n=== puppeteer-singleton.js Tests ===');

  const puppeteer = await import(join(srcPath, 'puppeteer-singleton.js'));
  assertTrue(puppeteer.default !== null, 'exports default puppeteer instance');
  assertTrue(typeof puppeteer.default.launch === 'function', 'has launch method');
  assertTrue(typeof puppeteer.default.connect === 'function', 'has connect method');

  console.log('\n=== config.js Tests ===');

  const config = await import(join(srcPath, 'config.js'));
  assertTrue(config.default !== null, 'exports default config');
  assertTrue(config.default.browserPath === undefined || typeof config.default.browserPath === 'string', 'browserPath is string or undefined');
  assertEqual(typeof config.default.browserDebugPort, 'number', 'browserDebugPort is number');
  assertEqual(typeof config.default.daemonPort, 'number', 'daemonPort is number');
  assertEqual(typeof config.default.daemonTTL, 'number', 'daemonTTL is number');
  assertEqual(typeof config.default.outputDir, 'string', 'outputDir is string');
}

async function main() {
  try {
    await runTests();
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test runner error:', err);
    process.exit(1);
  }
}

main();
