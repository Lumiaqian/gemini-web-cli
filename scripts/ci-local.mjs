#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { ARTIFACT_DIR, ROUTE_ID } from '../native-cli/hybrid-native-cli-node-core/src/route-metadata.mjs';

const ONLY_SUPPORTED_ROUTE = ROUTE_ID;

function fail(message, exitCode = 1) {
  console.error(`ERROR: ${message}`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    selectedRouteFlag: false,
    selectedRoute: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--selected-route') {
      args.selectedRouteFlag = true;
      const nextToken = argv[index + 1];
      if (nextToken && !nextToken.startsWith('--')) {
        args.selectedRoute = nextToken;
        index += 1;
      }
      continue;
    }

    fail(`unknown argument: ${token}`);
  }

  if (!args.selectedRouteFlag) {
    fail('missing required --selected-route flag');
  }

  return args;
}

function resolveRoute(args) {
  const routeId = args.selectedRoute ?? ONLY_SUPPORTED_ROUTE;
  if (routeId !== ONLY_SUPPORTED_ROUTE) {
    fail(`unsupported selected route: ${routeId}; only ${ONLY_SUPPORTED_ROUTE} is implemented`, 2);
  }
  return routeId;
}

function buildSteps(routeId) {
  return [
    {
      id: 'build',
      description: 'Build the selected hybrid route artifact and release metadata.',
      script: 'scripts/build-cli.mjs',
      args: ['--selected-route', routeId],
    },
    {
      id: 'contract',
      description: 'Validate frozen CLI contract fixtures and stdout cleanliness.',
      script: 'scripts/test-contract.mjs',
      args: ['--fixtures', 'contract'],
    },
    {
      id: 'unit',
      description: 'Run the deterministic unit harness suites.',
      script: 'scripts/test-unit.mjs',
      args: [],
    },
    {
      id: 'integration',
      description: 'Run the selected-route integration harness suites.',
      script: 'scripts/test-integration.mjs',
      args: ['--selected-route'],
    },
    {
      id: 'smoke',
      description: 'Run non-interactive smoke coverage, including the built artifact path.',
      script: 'scripts/run-smoke.mjs',
      args: ['--require-noninteractive'],
    },
    {
      id: 'docs',
      description: 'Verify CLI-first docs and compatibility-report drift checks.',
      script: 'scripts/check-docs.mjs',
      args: ['--require-cli-primary', '--require-compat-report', '--detect-stale-scripts', '--detect-missing-deps'],
    },
    {
      id: 'release-dry-run',
      description: 'Validate release metadata against the built hybrid artifact.',
      script: 'scripts/release-dry-run.mjs',
      args: ['--manifest', `${ARTIFACT_DIR}/release-metadata.json`, '--require-artifact-metadata'],
    },
  ];
}

function formatCommand(step) {
  return ['node', step.script, ...step.args].join(' ');
}

function runStep(step) {
  const result = spawnSync(process.execPath, [step.script, ...step.args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CI: '1',
    },
    stdio: 'inherit',
  });

  if (result.error) {
    fail(`unable to run ${step.id}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const routeId = resolveRoute(args);
  const steps = buildSteps(routeId);

  if (args.dryRun) {
    console.log(`DRY RUN local-ci route=${routeId} steps=${steps.length}`);
    for (const step of steps) {
      console.log(`step=${step.id} command="${formatCommand(step)}" description="${step.description}"`);
    }
    return;
  }

  steps.forEach((step, index) => {
    console.log(`RUN ci-step=${index + 1}/${steps.length} id=${step.id}`);
    runStep(step);
  });

  console.log(`OK local-ci route=${routeId} steps=${steps.length}`);
}

main();
