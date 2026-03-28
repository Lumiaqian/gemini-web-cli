#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeScaffold } from '../src/shell/run-scaffold-command.mjs';
import {
  ARTIFACT_DIR,
  CLI_ENTRYPOINT,
  ROUTE_ID,
  TEST_ENTRYPOINT,
  getRouteScaffoldMetadata,
} from '../src/route-metadata.mjs';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const IMPLEMENTATION_ROOT = path.resolve(TEST_ROOT, '..');
const SHELL_FILE = path.join(IMPLEMENTATION_ROOT, 'src', 'shell', 'run-scaffold-command.mjs');
const SESSION_BRIDGE_FILE = path.join(IMPLEMENTATION_ROOT, 'src', 'node-core', 'session-bridge.mjs');
const DAEMON_BRIDGE_FILE = path.join(IMPLEMENTATION_ROOT, 'src', 'node-core', 'daemon-bridge.mjs');

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    json: false,
  };

  for (const token of argv) {
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--json') {
      args.json = true;
      continue;
    }

    fail(`unknown argument: ${token}`);
  }

  return args;
}

function relativeFromRoot(targetPath) {
  return path.relative(process.cwd(), targetPath).split(path.sep).join('/');
}

const CHECKS = [
  {
    id: 'route-metadata',
    description: 'Selected route metadata stays pinned to hybrid-native-cli-node-core plus daemon keep.',
    run() {
      const metadata = getRouteScaffoldMetadata();
      if (metadata.routeId !== ROUTE_ID) {
        fail(`expected routeId ${ROUTE_ID}, got ${metadata.routeId}`);
      }
      if (metadata.daemonStrategy !== 'keep') {
        fail(`expected daemon strategy keep, got ${metadata.daemonStrategy}`);
      }
      if (metadata.artifactDir !== ARTIFACT_DIR) {
        fail(`expected artifact dir ${ARTIFACT_DIR}, got ${metadata.artifactDir}`);
      }
    },
  },
  {
    id: 'implementation-files',
    description: 'Route-local scaffold files exist in the new implementation area.',
    run() {
      const files = [
        path.resolve(process.cwd(), CLI_ENTRYPOINT),
        path.resolve(process.cwd(), TEST_ENTRYPOINT),
        SHELL_FILE,
        SESSION_BRIDGE_FILE,
        DAEMON_BRIDGE_FILE,
        path.join(IMPLEMENTATION_ROOT, 'README.md'),
      ];

      for (const filePath of files) {
        if (!existsSync(filePath)) {
          fail(`missing scaffold file: ${relativeFromRoot(filePath)}`);
        }
      }
    },
  },
  {
    id: 'shell-separation',
    description: 'The shell layer stays route-local and does not reach into the legacy src/ tree directly.',
    run() {
      const shellText = readFileSync(SHELL_FILE, 'utf8');
      if (shellText.includes('../../../../src/')) {
        fail('shell layer imports the legacy src/ tree directly');
      }
    },
  },
  {
    id: 'bridge-ownership',
    description: 'Route-local bridge files own the direct references into the legacy Node core.',
    run() {
      const sessionText = readFileSync(SESSION_BRIDGE_FILE, 'utf8');
      const daemonText = readFileSync(DAEMON_BRIDGE_FILE, 'utf8');

      if (!sessionText.includes("../../../../src/index.js")) {
        fail('session bridge no longer references src/index.js');
      }
      if (!daemonText.includes("../../../../src/browser.js")) {
        fail('daemon bridge no longer references src/browser.js');
      }
    },
  },
  {
    id: 'describe-scaffold',
    description: 'Scaffold description stays deterministic for build and developer docs.',
    run() {
      const payload = describeScaffold();
      if (payload.routeId !== ROUTE_ID) {
        fail(`describeScaffold route mismatch: ${payload.routeId}`);
      }
      if (payload.testEntrypoint !== TEST_ENTRYPOINT) {
        fail(`describeScaffold test entry mismatch: ${payload.testEntrypoint}`);
      }
      if (!Array.isArray(payload.nodeCoreBoundaries) || payload.nodeCoreBoundaries.length !== 2) {
        fail('describeScaffold must expose exactly two node core boundaries');
      }
    },
  },
];

function runChecks() {
  const results = [];

  for (const check of CHECKS) {
    check.run();
    results.push({ id: check.id, description: check.description, status: 'passed' });
  }

  return results;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.dryRun) {
    console.log(`DRY RUN selected-route-scaffold checks=${CHECKS.length}`);
    for (const check of CHECKS) {
      console.log(`check=${check.id} description="${check.description}"`);
    }
    return;
  }

  try {
    const results = runChecks();

    if (args.json) {
      console.log(JSON.stringify({ routeId: ROUTE_ID, checks: results }, null, 2));
      return;
    }

    console.log(`OK selected-route-scaffold route=${ROUTE_ID} checks=${results.length}`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
