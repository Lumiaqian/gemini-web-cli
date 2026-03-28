#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ARTIFACT_DIR,
  CLI_ENTRYPOINT,
  DAEMON_STRATEGY,
  ROUTE_ID,
  TEST_ENTRYPOINT,
  getRouteScaffoldMetadata,
} from '../native-cli/hybrid-native-cli-node-core/src/route-metadata.mjs';

const DEFAULT_MATRIX = 'specs/route-matrix.json';
const DEFAULT_OUTPUT_ROOT = 'dist/native-cli';
const IMPLEMENTED_ROUTES = new Set([ROUTE_ID]);
const PACKAGE_JSON = 'package.json';

function fail(code, message, exitCode = 1) {
  console.error(`ERROR ${code}: ${message}`);
  process.exit(exitCode);
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function parseArgs(argv) {
  const args = {
    matrix: DEFAULT_MATRIX,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    selectedRouteFlag: false,
    selectedRoute: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--selected-route') {
      args.selectedRouteFlag = true;
      const nextToken = argv[index + 1];
      if (nextToken && !nextToken.startsWith('--')) {
        args.selectedRoute = nextToken;
        index += 1;
      }
      continue;
    }
    if (token === '--matrix') {
      args.matrix = argv[++index] ?? fail('invalid-args', 'missing value for --matrix');
      continue;
    }
    if (token === '--output-root') {
      args.outputRoot = argv[++index] ?? fail('invalid-args', 'missing value for --output-root');
      continue;
    }

    fail('invalid-args', `unknown argument: ${token}`);
  }

  if (!args.selectedRouteFlag) {
    fail('invalid-args', 'missing required --selected-route flag');
  }

  return args;
}

function loadJson(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  let text;

  try {
    text = readFileSync(absolutePath, 'utf8');
  } catch (error) {
    fail('matrix-read-failed', `unable to read ${absolutePath}: ${error.message}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    fail('matrix-parse-failed', `invalid JSON in ${absolutePath}: ${error.message}`);
  }
}

function resolveSelectedRoute(args, matrix) {
  const routeId = args.selectedRoute ?? matrix?.finalDecision?.selectedRoute;
  if (typeof routeId !== 'string' || routeId.trim() === '') {
    fail('invalid-route', 'unable to resolve selected route from args or route matrix', 2);
  }
  return routeId;
}

function validateRouteSelection(routeId, matrix) {
  if (!IMPLEMENTED_ROUTES.has(routeId)) {
    fail(
      'invalid-route',
      `selected route "${routeId}" is not scaffolded; supported routes: ${[...IMPLEMENTED_ROUTES].join(', ')}`,
      2,
    );
  }

  if (matrix?.finalDecision?.selectedRoute !== ROUTE_ID) {
    fail(
      'route-matrix-mismatch',
      `route matrix final decision is "${matrix?.finalDecision?.selectedRoute}", expected "${ROUTE_ID}"`,
    );
  }

  if (matrix?.finalDaemonChoice?.routeId !== ROUTE_ID) {
    fail(
      'route-matrix-mismatch',
      `route matrix daemon route is "${matrix?.finalDaemonChoice?.routeId}", expected "${ROUTE_ID}"`,
    );
  }

  if (matrix?.finalDaemonChoice?.choice !== DAEMON_STRATEGY) {
    fail(
      'route-matrix-mismatch',
      `route matrix daemon choice is "${matrix?.finalDaemonChoice?.choice}", expected "${DAEMON_STRATEGY}"`,
    );
  }
}

function createRunnerText() {
  return `#!/usr/bin/env node
import { runHybridNativeCliScaffold } from '../../../native-cli/hybrid-native-cli-node-core/src/cli-dev-entry.mjs';

const exitCode = await runHybridNativeCliScaffold(process.argv.slice(2));
if (Number.isInteger(exitCode)) {
  process.exit(exitCode);
}
`;
}

function buildManifest(outputDirRelative, routeMetadata) {
  return {
    artifactVersion: 1,
    routeId: routeMetadata.routeId,
    daemonStrategy: routeMetadata.daemonStrategy,
    scaffoldVersion: routeMetadata.scaffoldVersion,
    buildEntrypoint: 'scripts/build-cli.mjs',
    sourceEntrypoint: CLI_ENTRYPOINT,
    testEntrypoint: TEST_ENTRYPOINT,
    artifactDir: outputDirRelative,
    artifactRunner: `${outputDirRelative}/run-dev.mjs`,
    nodeCoreBoundaries: routeMetadata.nodeCoreBoundaries,
  };
}

function loadPackageVersion() {
  const packageJson = loadJson(PACKAGE_JSON);
  if (typeof packageJson?.version !== 'string' || packageJson.version.trim() === '') {
    fail('package-metadata-mismatch', 'package.json version must be a non-empty string');
  }

  return packageJson.version.trim();
}

function computeSha256(filePath) {
  const fileBuffer = readFileSync(filePath);
  return createHash('sha256').update(fileBuffer).digest('hex');
}

function createInstallNotesText({ artifactDirRelative, runnerRelative, routeMetadata }) {
  return [
    'Hybrid native CLI local release notes',
    `- Route: ${routeMetadata.routeId}`,
    `- Artifact directory: ${artifactDirRelative}`,
    `- Entrypoint artifact: ${runnerRelative}`,
    '- Install prerequisites: Node.js 18+ and repository dependencies installed via npm install.',
    '- Runtime boundary: this shipped CLI wrapper still delegates to the private Node browser/daemon core and is not a fully standalone native binary.',
    '- Private runtime seam: route-local bridges continue to reach src/index.js and src/browser.js behind the hybrid boundary.',
    '- Local-only dry-run: this artifact metadata exists for deterministic local CI and release verification only; no remote publish step is executed here.',
  ].join('\n');
}

function buildReleaseMetadata({
  artifactDirRelative,
  buildManifestPathRelative,
  checksum,
  installNotesPathRelative,
  packageVersion,
  routeMetadata,
  runnerRelative,
}) {
  return {
    schemaVersion: 1,
    kind: 'native-cli-release-manifest',
    releaseMode: 'dry-run-local',
    packageName: 'gemini-web-cli',
    version: packageVersion,
    routeId: routeMetadata.routeId,
    artifactId: `gemini-web-cli-${routeMetadata.routeId}`,
    artifactDir: artifactDirRelative,
    artifactPath: runnerRelative,
    buildManifestPath: buildManifestPathRelative,
    daemonStrategy: routeMetadata.daemonStrategy,
    checksum: {
      algorithm: 'sha256',
      value: checksum,
    },
    installNotes: {
      source: installNotesPathRelative,
      summary: 'Requires Node.js 18+ with repo dependencies installed; the shipped CLI still wraps the private Node core/runtime.',
    },
    runtime: {
      kind: 'hybrid-private-node-core',
      nodeRuntime: 'required',
      privateNodeCore: true,
      note: 'The hybrid release artifact is a native CLI wrapper around a private Node browser/daemon runtime and must keep that dependency explicit.',
    },
    nodeCoreBoundaries: routeMetadata.nodeCoreBoundaries,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const matrix = loadJson(args.matrix);
  const selectedRoute = resolveSelectedRoute(args, matrix);

  validateRouteSelection(selectedRoute, matrix);

  const routeMetadata = getRouteScaffoldMetadata();
  const packageVersion = loadPackageVersion();
  const outputDir = path.resolve(process.cwd(), args.outputRoot, selectedRoute);
  const outputDirRelative = toPosix(path.relative(process.cwd(), outputDir));
  const manifest = buildManifest(outputDirRelative, routeMetadata);
  const runnerPath = path.join(outputDir, 'run-dev.mjs');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const installNotesPath = path.join(outputDir, 'install-notes.txt');
  const releaseMetadataPath = path.join(outputDir, 'release-metadata.json');

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(runnerPath, createRunnerText(), { mode: 0o755 });
  chmodSync(runnerPath, 0o755);

  const runnerRelative = toPosix(path.relative(process.cwd(), runnerPath));
  const manifestPathRelative = toPosix(path.relative(process.cwd(), manifestPath));
  const installNotesPathRelative = toPosix(path.relative(process.cwd(), installNotesPath));
  writeFileSync(
    installNotesPath,
    `${createInstallNotesText({ artifactDirRelative: outputDirRelative, runnerRelative, routeMetadata })}\n`,
  );

  const releaseMetadata = buildReleaseMetadata({
    artifactDirRelative: outputDirRelative,
    buildManifestPathRelative: manifestPathRelative,
    checksum: computeSha256(runnerPath),
    installNotesPathRelative,
    packageVersion,
    routeMetadata,
    runnerRelative,
  });
  writeFileSync(releaseMetadataPath, `${JSON.stringify(releaseMetadata, null, 2)}\n`);

  if (ARTIFACT_DIR !== `${DEFAULT_OUTPUT_ROOT}/${ROUTE_ID}`) {
    fail('artifact-metadata-mismatch', `route metadata artifact dir drifted from ${DEFAULT_OUTPUT_ROOT}/${ROUTE_ID}`);
  }

  console.log(`OK build-cli route=${selectedRoute}`);
  console.log(`artifact_dir=${outputDirRelative}`);
  console.log(`manifest=${manifestPathRelative}`);
  console.log(`runner=${runnerRelative}`);
  console.log(`install_notes=${installNotesPathRelative}`);
  console.log(`release_manifest=${toPosix(path.relative(process.cwd(), releaseMetadataPath))}`);
}

main();
