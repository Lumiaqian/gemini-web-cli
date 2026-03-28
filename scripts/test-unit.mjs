#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const SUITES = [
  {
    id: 'parity-baseline',
    description: 'Validate parity matrix coverage and required migration classifications.',
    script: 'scripts/check-parity.mjs',
    args: ['--source', 'cli', '--expected-count', '16', '--require-classification'],
  },
  {
    id: 'contract-fixtures',
    description: 'Validate CLI machine-envelope fixtures and stdout cleanliness.',
    script: 'scripts/test-contract.mjs',
    args: ['--fixtures', 'contract'],
  },
  {
    id: 'selected-route-scaffold',
    description: 'Validate the hybrid native CLI scaffold boundary and route-local test entry.',
    script: 'native-cli/hybrid-native-cli-node-core/test/scaffold-test-entry.mjs',
    args: [],
  },
  {
    id: 'core-modules',
    description: 'Unit tests for errors.js, util.js, config.js, puppeteer-singleton.js.',
    script: 'test/unit/core-modules-test.mjs',
    args: [],
  },
];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    suiteIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--suite') {
      args.suiteIds.push(argv[++index] ?? fail('missing value for --suite'));
      continue;
    }

    fail(`unknown argument: ${token}`);
  }

  return args;
}

function selectSuites(args) {
  if (args.suiteIds.length === 0) {
    return SUITES;
  }

  const selected = args.suiteIds.map((suiteId) => {
    const suite = SUITES.find((entry) => entry.id === suiteId);
    if (!suite) {
      fail(`unknown suite: ${suiteId}`);
    }
    return suite;
  });

  return selected;
}

function formatCommand(suite) {
  return ['node', suite.script, ...suite.args].join(' ');
}

function runSuite(suite) {
  const result = spawnSync(process.execPath, [suite.script, ...suite.args], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    fail(`unable to run ${suite.id}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const suites = selectSuites(args);

  if (args.dryRun) {
    console.log(`DRY RUN unit-harness suites=${suites.length}`);
    for (const suite of suites) {
      console.log(`suite=${suite.id} command="${formatCommand(suite)}" description="${suite.description}"`);
    }
    return;
  }

  for (const suite of suites) {
    console.log(`RUN unit-suite=${suite.id}`);
    runSuite(suite);
  }

  console.log(`OK unit-suites=${suites.length}`);
}

main();
