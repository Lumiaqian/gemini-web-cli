#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ARTIFACT_DIR } from '../native-cli/hybrid-native-cli-node-core/src/route-metadata.mjs';

const DEFAULT_FIXTURES_DIR = 'specs/fixtures/smoke';
const TERMINAL_STATES = new Set(['succeeded', 'failed', 'timed_out', 'interrupted']);
const COMMAND_PATTERN = /^[a-z][a-z0-9-]*$/;
const EXECUTION_MODES = new Set(['metadata-only', 'built-artifact-cli']);

function isNegativePolicyFixtureName(fileName) {
  return fileName.startsWith('bad-');
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    fixturePaths: [],
    fixturesDir: DEFAULT_FIXTURES_DIR,
    requireNoninteractive: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--fixture') {
      args.fixturePaths.push(argv[++index] ?? fail('missing value for --fixture'));
      continue;
    }
    if (token === '--fixtures-dir') {
      args.fixturesDir = argv[++index] ?? fail('missing value for --fixtures-dir');
      continue;
    }
    if (token === '--require-noninteractive') {
      args.requireNoninteractive = true;
      continue;
    }

    fail(`unknown argument: ${token}`);
  }

  return args;
}

function resolveFromRoot(inputPath) {
  return path.resolve(process.cwd(), inputPath);
}

function ensureNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCiEnvironment() {
  if (!('CI' in process.env)) {
    return false;
  }
  const value = String(process.env.CI).trim().toLowerCase();
  return value !== '' && value !== '0' && value !== 'false';
}

function getExecutionMode(fixture) {
  return fixture?.execution?.mode ?? 'metadata-only';
}

function collectFixturePaths(args) {
  if (args.fixturePaths.length > 0) {
    return [...new Set(args.fixturePaths)];
  }

  const fixturesDir = resolveFromRoot(args.fixturesDir);
  let entries;
  try {
    entries = readdirSync(fixturesDir, { withFileTypes: true });
  } catch (error) {
    fail(`unable to read ${fixturesDir}: ${error.message}`);
  }

  const paths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .filter((entry) => !isNegativePolicyFixtureName(entry.name))
    .map((entry) => path.join(args.fixturesDir, entry.name))
    .sort();

  if (paths.length === 0) {
    fail(`no default smoke fixtures found in ${args.fixturesDir}`);
  }

  return paths;
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
    return {
      filePath: absolutePath,
      data: JSON.parse(text),
    };
  } catch (error) {
    fail(`invalid JSON in ${absolutePath}: ${error.message}`);
  }
}

function validateFixture(fixture, filePath) {
  const errors = [];
  const label = path.relative(process.cwd(), filePath);

  if (!isPlainObject(fixture)) {
    return [`${label} must be an object`];
  }
  if (fixture.fixtureVersion !== 1) {
    errors.push(`${label} fixtureVersion must be 1`);
  }
  if (fixture.kind !== 'cli-smoke-fixture') {
    errors.push(`${label} kind must be cli-smoke-fixture`);
  }
  if (!ensureNonEmptyString(fixture.name)) {
    errors.push(`${label} name must be a non-empty string`);
  }
  if (!ensureNonEmptyString(fixture.description)) {
    errors.push(`${label} description must be a non-empty string`);
  }
  if (fixture.routeNeutral !== true) {
    errors.push(`${label} routeNeutral must be true`);
  }
  if (typeof fixture.interactive !== 'boolean') {
    errors.push(`${label} interactive must be a boolean`);
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

  if (!isPlainObject(fixture.execution)) {
    errors.push(`${label} execution must be an object`);
  } else {
    const timeoutIsNull = fixture.execution.timeoutMs === null;
    const timeoutIsInteger = Number.isInteger(fixture.execution.timeoutMs) && fixture.execution.timeoutMs > 0;
    if (!timeoutIsNull && !timeoutIsInteger) {
      errors.push(`${label} execution.timeoutMs must be null or a positive integer`);
    }
    if (typeof fixture.execution.requiresLogin !== 'boolean') {
      errors.push(`${label} execution.requiresLogin must be a boolean`);
    }
    if (!ensureNonEmptyString(fixture.execution.notes)) {
      errors.push(`${label} execution.notes must be a non-empty string`);
    }
    if (!EXECUTION_MODES.has(getExecutionMode(fixture))) {
      errors.push(`${label} execution.mode must be one of ${Array.from(EXECUTION_MODES).join(', ')}`);
    }
  }

  if (!isPlainObject(fixture.expectations)) {
    errors.push(`${label} expectations must be an object`);
  } else {
    if (fixture.expectations.stdoutContract !== 'json-only') {
      errors.push(`${label} expectations.stdoutContract must be json-only`);
    }
    if (!ensureNonEmptyString(fixture.expectations.stderrContract)) {
      errors.push(`${label} expectations.stderrContract must be a non-empty string`);
    }
    if (!Array.isArray(fixture.expectations.allowedTerminalStates) || fixture.expectations.allowedTerminalStates.length === 0) {
      errors.push(`${label} expectations.allowedTerminalStates must be a non-empty array`);
    } else {
      for (const state of fixture.expectations.allowedTerminalStates) {
        if (!TERMINAL_STATES.has(state)) {
          errors.push(`${label} expectations.allowedTerminalStates contains invalid value: ${state}`);
        }
      }
    }
  }

  if (!isPlainObject(fixture.evidence)) {
    errors.push(`${label} evidence must be an object`);
  } else {
    if (!ensureNonEmptyString(fixture.evidence.captureSource)) {
      errors.push(`${label} evidence.captureSource must be a non-empty string`);
    }
    if (!ensureNonEmptyString(fixture.evidence.reason)) {
      errors.push(`${label} evidence.reason must be a non-empty string`);
    }
  }

  return errors;
}

function enforcePolicies(fixtures, noninteractiveRequired) {
  const errors = [];

  if (!noninteractiveRequired) {
    return errors;
  }

  for (const fixture of fixtures) {
    if (fixture.data.interactive === true) {
      errors.push(`${path.relative(process.cwd(), fixture.filePath)} declares interactive=true but non-interactive execution is required`);
    }
  }

  return errors;
}

function resolveBinary(binary) {
  if (binary === '<native-cli>') {
    return path.resolve(process.cwd(), ARTIFACT_DIR, 'run-dev.mjs');
  }

  return path.resolve(process.cwd(), binary);
}

function validateExecutionResult(fixture, result, resolvedBinary) {
  if (result.error) {
    fail(`unable to run smoke fixture ${fixture.data.name}: ${result.error.message}`);
  }

  if (typeof result.stdout !== 'string') {
    fail(`smoke fixture ${fixture.data.name} did not produce captured stdout`);
  }

  const stdoutText = result.stdout.trim();
  if (!stdoutText) {
    fail(`smoke fixture ${fixture.data.name} produced empty stdout`);
  }

  let envelope;
  try {
    envelope = JSON.parse(stdoutText);
  } catch (error) {
    fail(`smoke fixture ${fixture.data.name} produced non-JSON stdout from ${path.relative(process.cwd(), resolvedBinary)}: ${error.message}`);
  }

  const terminalState = envelope?.execution?.terminalState;
  if (!fixture.data.expectations.allowedTerminalStates.includes(terminalState)) {
    fail(`smoke fixture ${fixture.data.name} produced unexpected terminal state: ${terminalState}`);
  }

  if (!Number.isInteger(result.status)) {
    fail(`smoke fixture ${fixture.data.name} exited without a numeric status`);
  }

  if (envelope?.exitCode !== result.status) {
    fail(`smoke fixture ${fixture.data.name} exit code mismatch: process=${result.status} envelope=${envelope?.exitCode}`);
  }
}

function executeBuiltArtifactFixture(fixture) {
  const resolvedBinary = resolveBinary(fixture.data.commandLine.binary);
  if (!existsSync(resolvedBinary)) {
    fail(`smoke fixture ${fixture.data.name} requires built artifact at ${path.relative(process.cwd(), resolvedBinary)}`);
  }

  const result = spawnSync(
    process.execPath,
    [resolvedBinary, fixture.data.commandLine.subcommand, ...fixture.data.commandLine.args],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CI: '1',
      },
      encoding: 'utf8',
    },
  );

  validateExecutionResult(fixture, result, resolvedBinary);
  console.log(
    `EXECUTED smoke-fixture=${fixture.data.name} mode=${getExecutionMode(fixture.data)} binary=${path.relative(process.cwd(), resolvedBinary)}`,
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixturePaths = collectFixturePaths(args);
  const fixtures = fixturePaths.map((fixturePath) => loadJson(fixturePath));
  const allErrors = [];
  const names = new Map();

  for (const fixture of fixtures) {
    allErrors.push(...validateFixture(fixture.data, fixture.filePath));
    if (ensureNonEmptyString(fixture.data.name)) {
      const priorPath = names.get(fixture.data.name);
      if (priorPath) {
        allErrors.push(`duplicate smoke fixture name: ${fixture.data.name} (${path.relative(process.cwd(), priorPath)} and ${path.relative(process.cwd(), fixture.filePath)})`);
      } else {
        names.set(fixture.data.name, fixture.filePath);
      }
    }
  }

  const noninteractiveRequired = args.requireNoninteractive || isCiEnvironment();
  allErrors.push(...enforcePolicies(fixtures, noninteractiveRequired));

  if (allErrors.length > 0) {
    fail(allErrors.join('; '));
  }

  const policy = noninteractiveRequired ? 'required' : 'allowed';

  if (args.dryRun) {
    console.log(`DRY RUN smoke-harness fixtures=${fixtures.length} noninteractive=${policy}`);
    for (const fixture of fixtures) {
      console.log(
        `fixture=${fixture.data.name} interactive=${fixture.data.interactive} mode=${getExecutionMode(fixture.data)} command=${fixture.data.commandLine.subcommand} requiresLogin=${fixture.data.execution.requiresLogin} path=${path.relative(process.cwd(), fixture.filePath)}`
      );
    }
    return;
  }

  for (const fixture of fixtures) {
    if (getExecutionMode(fixture.data) === 'built-artifact-cli') {
      executeBuiltArtifactFixture(fixture);
      continue;
    }
    console.log(`REGISTER smoke-fixture=${fixture.data.name} path=${path.relative(process.cwd(), fixture.filePath)}`);
  }
  console.log(`OK smoke-fixtures=${fixtures.length} execution=metadata-and-artifact noninteractive=${policy}`);
}

main();
