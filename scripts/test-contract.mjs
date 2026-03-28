#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

const SPEC_DIR = 'specs';
const DEFAULT_EXIT_CODES = `${SPEC_DIR}/exit-codes.json`;
const FIXTURE_SETS = {
  contract: [
    `${SPEC_DIR}/fixtures/contract-success.json`,
    `${SPEC_DIR}/fixtures/contract-failure.json`,
  ],
};
const REQUIRED_EXIT_CODES = [
  'success',
  'invalid-args',
  'auth-failure',
  'browser-startup-failure',
  'selector-failure',
  'timeout',
  'interrupted',
  'internal-error',
];
const TERMINAL_STATES = new Set(['succeeded', 'failed', 'timed_out', 'interrupted']);
const SIGNAL_PATTERN = /^SIG[A-Z0-9]+$/;
const COMMAND_PATTERN = /^[a-z][a-z0-9-]*$/;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    fixtureSet: null,
    fixturePaths: [],
    checkStdoutClean: false,
    exitCodesPath: DEFAULT_EXIT_CODES,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--fixtures') {
      args.fixtureSet = argv[++i] ?? fail('missing value for --fixtures');
      continue;
    }
    if (token === '--fixture') {
      args.fixturePaths.push(argv[++i] ?? fail('missing value for --fixture'));
      continue;
    }
    if (token === '--check-stdout-clean') {
      args.checkStdoutClean = true;
      continue;
    }
    if (token === '--exit-codes') {
      args.exitCodesPath = argv[++i] ?? fail('missing value for --exit-codes');
      continue;
    }

    fail(`unknown argument: ${token}`);
  }

  if (!args.fixtureSet && args.fixturePaths.length === 0) {
    args.fixtureSet = 'contract';
  }

  if (args.fixtureSet === 'contract') {
    args.checkStdoutClean = true;
  }

  return args;
}

function resolveFromRoot(inputPath) {
  return path.resolve(process.cwd(), inputPath);
}

function loadJson(filePath) {
  const absolutePath = resolveFromRoot(filePath);
  let text;
  try {
    text = readFileSync(absolutePath, 'utf8');
  } catch (error) {
    fail(`unable to read ${absolutePath}: ${error.message}`);
  }

  try {
    return { filePath: absolutePath, data: JSON.parse(text) };
  } catch (error) {
    fail(`invalid JSON in ${absolutePath}: ${error.message}`);
  }
}

function ensureNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value) {
  return ensureNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateExitCodes(document) {
  const errors = [];

  if (!isPlainObject(document)) {
    return { errors: ['exit code document must be an object'], byName: new Map() };
  }

  if (document.schemaVersion !== 1) {
    errors.push('exit code schemaVersion must be 1');
  }
  if (document.defaultSuccessCode !== 0) {
    errors.push('defaultSuccessCode must be 0');
  }
  if (!Array.isArray(document.codes)) {
    errors.push('codes must be an array');
    return { errors, byName: new Map() };
  }

  const byName = new Map();
  const byExitCode = new Map();

  document.codes.forEach((entry, index) => {
    const label = `codes[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${label} must be an object`);
      return;
    }
    if (!ensureNonEmptyString(entry.name)) {
      errors.push(`${label}.name must be a non-empty string`);
      return;
    }
    if (!Number.isInteger(entry.exitCode) || entry.exitCode < 0) {
      errors.push(`${label}.exitCode must be a non-negative integer`);
    }
    if (!ensureNonEmptyString(entry.description)) {
      errors.push(`${label}.description must be a non-empty string`);
    }
    if (typeof entry.retryable !== 'boolean') {
      errors.push(`${label}.retryable must be a boolean`);
    }
    if (byName.has(entry.name)) {
      errors.push(`duplicate exit code name: ${entry.name}`);
    } else {
      byName.set(entry.name, entry);
    }
    if (byExitCode.has(entry.exitCode)) {
      errors.push(`duplicate numeric exit code: ${entry.exitCode}`);
    } else {
      byExitCode.set(entry.exitCode, entry.name);
    }
  });

  for (const name of REQUIRED_EXIT_CODES) {
    if (!byName.has(name)) {
      errors.push(`missing required exit code entry: ${name}`);
    }
  }

  if (byName.get('success')?.exitCode !== 0) {
    errors.push('success exit code must be 0');
  }

  return { errors, byName };
}

function validateTiming(timing, errors, label) {
  if (!isPlainObject(timing)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (!isIsoDate(timing.startedAt)) {
    errors.push(`${label}.startedAt must be an ISO-8601 timestamp`);
  }
  if (!isIsoDate(timing.finishedAt)) {
    errors.push(`${label}.finishedAt must be an ISO-8601 timestamp`);
  }
  if (!Number.isInteger(timing.durationMs) || timing.durationMs < 0) {
    errors.push(`${label}.durationMs must be a non-negative integer`);
  }
}

function validateExecution(execution, errors, label) {
  if (!isPlainObject(execution)) {
    errors.push(`${label} must be an object`);
    return;
  }
  const timeoutIsNull = execution.timeoutMs === null;
  const timeoutIsInteger = Number.isInteger(execution.timeoutMs) && execution.timeoutMs > 0;
  if (!timeoutIsNull && !timeoutIsInteger) {
    errors.push(`${label}.timeoutMs must be null or a positive integer`);
  }
  if (!TERMINAL_STATES.has(execution.terminalState)) {
    errors.push(`${label}.terminalState must be one of ${Array.from(TERMINAL_STATES).join(', ')}`);
  }
  const signalOk = execution.cancelledBySignal === null || (ensureNonEmptyString(execution.cancelledBySignal) && SIGNAL_PATTERN.test(execution.cancelledBySignal));
  if (!signalOk) {
    errors.push(`${label}.cancelledBySignal must be null or a signal name like SIGINT`);
  }
}

function validateError(error, exitCodesByName, errors, label) {
  if (!isPlainObject(error)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (!ensureNonEmptyString(error.category)) {
    errors.push(`${label}.category must be a non-empty string`);
  } else if (!exitCodesByName.has(error.category)) {
    errors.push(`${label}.category is not in exit-codes.json: ${error.category}`);
  }
  if (!ensureNonEmptyString(error.code)) {
    errors.push(`${label}.code must be a non-empty string`);
  }
  if (!ensureNonEmptyString(error.message)) {
    errors.push(`${label}.message must be a non-empty string`);
  }
  if (typeof error.retryable !== 'boolean') {
    errors.push(`${label}.retryable must be a boolean`);
  }
  if (!(error.details === null || isPlainObject(error.details))) {
    errors.push(`${label}.details must be null or an object`);
  }
}

function validateEnvelope(envelope, expectedExitCode, exitCodesByName, fileLabel) {
  const errors = [];

  if (!isPlainObject(envelope)) {
    return [`${fileLabel} envelope must be an object`];
  }

  if (envelope.schemaVersion !== 1) {
    errors.push(`${fileLabel} envelope.schemaVersion must be 1`);
  }
  if (envelope.mode !== 'json') {
    errors.push(`${fileLabel} envelope.mode must be json`);
  }
  if (!ensureNonEmptyString(envelope.command) || !COMMAND_PATTERN.test(envelope.command)) {
    errors.push(`${fileLabel} envelope.command must be flat kebab-case`);
  }
  if (!ensureNonEmptyString(envelope.requestId)) {
    errors.push(`${fileLabel} envelope.requestId must be a non-empty string`);
  }
  if (typeof envelope.ok !== 'boolean') {
    errors.push(`${fileLabel} envelope.ok must be a boolean`);
  }
  if (!Number.isInteger(envelope.exitCode) || envelope.exitCode < 0) {
    errors.push(`${fileLabel} envelope.exitCode must be a non-negative integer`);
  }
  if (Number.isInteger(envelope.exitCode) && envelope.exitCode !== expectedExitCode) {
    errors.push(`${fileLabel} envelope.exitCode (${envelope.exitCode}) does not match expectedExitCode (${expectedExitCode})`);
  }

  validateTiming(envelope.timing, errors, `${fileLabel} envelope.timing`);
  validateExecution(envelope.execution, errors, `${fileLabel} envelope.execution`);

  const resultIsValid = envelope.result === null || isPlainObject(envelope.result);
  if (!resultIsValid) {
    errors.push(`${fileLabel} envelope.result must be null or an object`);
  }
  const errorIsValid = envelope.error === null || isPlainObject(envelope.error);
  if (!errorIsValid) {
    errors.push(`${fileLabel} envelope.error must be null or an object`);
  }

  if (envelope.ok === true) {
    if (envelope.exitCode !== 0) {
      errors.push(`${fileLabel} successful envelopes must use exitCode 0`);
    }
    if (envelope.execution?.terminalState !== 'succeeded') {
      errors.push(`${fileLabel} successful envelopes must use execution.terminalState=succeeded`);
    }
    if (envelope.result === null) {
      errors.push(`${fileLabel} successful envelopes must provide result`);
    }
    if (envelope.error !== null) {
      errors.push(`${fileLabel} successful envelopes must set error to null`);
    }
  }

  if (envelope.ok === false) {
    if (envelope.result !== null) {
      errors.push(`${fileLabel} failed envelopes must set result to null`);
    }
    if (envelope.error === null) {
      errors.push(`${fileLabel} failed envelopes must provide error`);
    } else {
      validateError(envelope.error, exitCodesByName, errors, `${fileLabel} envelope.error`);
      const mappedExitCode = exitCodesByName.get(envelope.error.category)?.exitCode;
      if (mappedExitCode !== undefined && mappedExitCode !== envelope.exitCode) {
        errors.push(`${fileLabel} exitCode ${envelope.exitCode} does not match error category ${envelope.error.category} (${mappedExitCode})`);
      }
      if (envelope.error.category === 'timeout' && envelope.execution?.terminalState !== 'timed_out') {
        errors.push(`${fileLabel} timeout errors must use execution.terminalState=timed_out`);
      }
      if (envelope.error.category === 'interrupted' && envelope.execution?.terminalState !== 'interrupted') {
        errors.push(`${fileLabel} interrupted errors must use execution.terminalState=interrupted`);
      }
      if (!['timeout', 'interrupted'].includes(envelope.error.category) && envelope.execution?.terminalState !== 'failed') {
        errors.push(`${fileLabel} non-timeout, non-interrupted errors must use execution.terminalState=failed`);
      }
    }
  }

  if (envelope.execution?.terminalState === 'interrupted' && envelope.execution?.cancelledBySignal === null) {
    errors.push(`${fileLabel} interrupted envelopes must record execution.cancelledBySignal`);
  }
  if (envelope.execution?.terminalState !== 'interrupted' && envelope.execution?.cancelledBySignal !== null) {
    errors.push(`${fileLabel} only interrupted envelopes may set execution.cancelledBySignal`);
  }

  return errors;
}

function validateFixture(fixture, exitCodesByName, filePath, checkStdoutClean) {
  const errors = [];
  const label = path.relative(process.cwd(), filePath);

  if (!isPlainObject(fixture)) {
    return [`${label} must be an object`];
  }
  if (fixture.fixtureVersion !== 1) {
    errors.push(`${label} fixtureVersion must be 1`);
  }
  if (fixture.kind !== 'cli-contract-fixture') {
    errors.push(`${label} kind must be cli-contract-fixture`);
  }
  if (!ensureNonEmptyString(fixture.name)) {
    errors.push(`${label} name must be a non-empty string`);
  }
  if (!ensureNonEmptyString(fixture.description)) {
    errors.push(`${label} description must be a non-empty string`);
  }
  if (!Number.isInteger(fixture.expectedExitCode) || fixture.expectedExitCode < 0) {
    errors.push(`${label} expectedExitCode must be a non-negative integer`);
  }
  if (!ensureNonEmptyString(fixture.stdout)) {
    errors.push(`${label} stdout must be a non-empty string`);
  }
  if (typeof fixture.stderr !== 'string') {
    errors.push(`${label} stderr must be a string`);
  }
  if (!isPlainObject(fixture.commandLine)) {
    errors.push(`${label} commandLine must be an object`);
  } else {
    if (!ensureNonEmptyString(fixture.commandLine.binary)) {
      errors.push(`${label} commandLine.binary must be a non-empty string`);
    }
    if (!ensureNonEmptyString(fixture.commandLine.subcommand) || !COMMAND_PATTERN.test(fixture.commandLine.subcommand)) {
      errors.push(`${label} commandLine.subcommand must be flat kebab-case`);
    }
    if (!Array.isArray(fixture.commandLine.args) || fixture.commandLine.args.some((arg) => !ensureNonEmptyString(arg))) {
      errors.push(`${label} commandLine.args must be an array of non-empty strings`);
    }
  }

  errors.push(...validateEnvelope(fixture.envelope, fixture.expectedExitCode, exitCodesByName, label));

  if (isPlainObject(fixture.commandLine) && isPlainObject(fixture.envelope) && fixture.commandLine.subcommand !== fixture.envelope.command) {
    errors.push(`${label} commandLine.subcommand must match envelope.command`);
  }

  if (checkStdoutClean) {
    let parsedStdout;
    try {
      parsedStdout = JSON.parse(fixture.stdout.trim());
    } catch (error) {
      errors.push(`${label} stdout is not clean JSON: ${error.message}`);
      return errors;
    }

    if (stableStringify(parsedStdout) !== stableStringify(fixture.envelope)) {
      errors.push(`${label} stdout JSON does not match fixture.envelope`);
    }
  }

  return errors;
}

function collectFixturePaths(args) {
  const paths = [];

  if (args.fixtureSet) {
    const set = FIXTURE_SETS[args.fixtureSet];
    if (!set) {
      fail(`unknown fixture set: ${args.fixtureSet}`);
    }
    paths.push(...set);
  }

  paths.push(...args.fixturePaths);

  if (paths.length === 0) {
    fail('no fixtures selected');
  }

  return [...new Set(paths)];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixturePaths = collectFixturePaths(args);
  const exitCodesDocument = loadJson(args.exitCodesPath);
  const exitCodeValidation = validateExitCodes(exitCodesDocument.data);
  if (exitCodeValidation.errors.length > 0) {
    fail(exitCodeValidation.errors.join('; '));
  }

  const allErrors = [];
  for (const fixturePath of fixturePaths) {
    const fixtureDocument = loadJson(fixturePath);
    allErrors.push(...validateFixture(
      fixtureDocument.data,
      exitCodeValidation.byName,
      fixtureDocument.filePath,
      args.checkStdoutClean,
    ));
  }

  if (allErrors.length > 0) {
    fail(allErrors.join('; '));
  }

  const summary = [
    `fixtures=${fixturePaths.length}`,
    `exitCodes=${exitCodeValidation.byName.size}`,
    `stdoutClean=${args.checkStdoutClean ? 'checked' : 'skipped'}`,
  ];
  console.log(`OK ${summary.join(' ')}`);
}

main();
