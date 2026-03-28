#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const SUITES = [
  {
    id: 'route-matrix-baseline',
    description: 'Validate route scoring completeness and final daemon decision wiring.',
    script: 'scripts/check-route-matrix.mjs',
    args: ['--require-go', '--require-rust', '--require-hybrid', '--require-daemon-decision'],
  },
  {
    id: 'smoke-registration',
    description: 'Validate smoke fixture registration without binding to a route-specific runner.',
    script: 'scripts/run-smoke.mjs',
    args: ['--dry-run'],
  },
  {
    id: 'lifecycle',
    description: 'Verify keep-daemon lifecycle happy-path semantics through the route-local lifecycle adapter.',
    script: 'native-cli/hybrid-native-cli-node-core/test/lifecycle-test-entry.mjs',
    args: ['--scenario', 'happy'],
  },
  {
    id: 'lifecycle-stale',
    description: 'Verify stale lifecycle states fail deterministically instead of hanging.',
    script: 'native-cli/hybrid-native-cli-node-core/test/lifecycle-test-entry.mjs',
    args: ['--scenario', 'stale'],
  },
  {
    id: 'text-session-diagnostics',
    description: 'Verify migrated session/model/text/diagnostic commands and documented failure coverage.',
    script: 'native-cli/hybrid-native-cli-node-core/test/text-session-diagnostics-test-entry.mjs',
    args: [],
  },
  {
    id: 'image-media',
    description: 'Verify migrated image/media commands, file-output payloads, and deterministic failure coverage.',
    script: 'native-cli/hybrid-native-cli-node-core/test/image-media-test-entry.mjs',
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
    selectedRoute: false,
    suiteIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--selected-route') {
      args.selectedRoute = true;
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

  return args.suiteIds.map((suiteId) => {
    const suite = SUITES.find((entry) => entry.id === suiteId);
    if (!suite) {
      fail(`unknown suite: ${suiteId}`);
    }
    return suite;
  });
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
    console.log(`DRY RUN integration-harness suites=${suites.length} selected_route=${args.selectedRoute}`);
    for (const suite of suites) {
      console.log(`suite=${suite.id} command="${formatCommand(suite)}" description="${suite.description}"`);
    }
    return;
  }

  for (const suite of suites) {
    console.log(`RUN integration-suite=${suite.id}`);
    runSuite(suite);
  }

  console.log(`OK integration-suites=${suites.length}`);
}

main();
