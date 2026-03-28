import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const IMPLEMENTATION_ROOT = path.resolve(SOURCE_DIR, '..');

export const ROUTE_ID = 'hybrid-native-cli-node-core';
export const DAEMON_STRATEGY = 'keep';
export const SCAFFOLD_VERSION = 1;
export const IMPLEMENTATION_ROOT_RELATIVE = 'native-cli/hybrid-native-cli-node-core';
export const CLI_ENTRYPOINT = `${IMPLEMENTATION_ROOT_RELATIVE}/src/cli-dev-entry.mjs`;
export const TEST_ENTRYPOINT = `${IMPLEMENTATION_ROOT_RELATIVE}/test/scaffold-test-entry.mjs`;
export const BUILD_ENTRYPOINT = 'scripts/build-cli.mjs';
export const ARTIFACT_DIR = `dist/native-cli/${ROUTE_ID}`;

export const NODE_CORE_BOUNDARIES = Object.freeze([
  Object.freeze({
    id: 'session-api',
    adapter: `${IMPLEMENTATION_ROOT_RELATIVE}/src/node-core/session-bridge.mjs`,
    source: 'src/index.js',
    description: 'Private bridge to createGeminiSession()/disconnect() for the shared Node session API.',
  }),
  Object.freeze({
    id: 'daemon-api',
    adapter: `${IMPLEMENTATION_ROOT_RELATIVE}/src/node-core/daemon-bridge.mjs`,
    source: 'src/browser.js',
    description: 'Private bridge to ensureBrowser()/disconnect() plus detached daemon endpoint metadata.',
  }),
]);

export function getImplementationRoot() {
  return IMPLEMENTATION_ROOT;
}

export function getRouteScaffoldMetadata() {
  return {
    routeId: ROUTE_ID,
    daemonStrategy: DAEMON_STRATEGY,
    scaffoldVersion: SCAFFOLD_VERSION,
    implementationRoot: IMPLEMENTATION_ROOT_RELATIVE,
    cliEntrypoint: CLI_ENTRYPOINT,
    testEntrypoint: TEST_ENTRYPOINT,
    buildEntrypoint: BUILD_ENTRYPOINT,
    artifactDir: ARTIFACT_DIR,
    nodeCoreBoundaries: NODE_CORE_BOUNDARIES.map((boundary) => ({ ...boundary })),
  };
}
