#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ARTIFACT_DIR, DAEMON_STRATEGY, ROUTE_ID } from '../native-cli/hybrid-native-cli-node-core/src/route-metadata.mjs';

const DEFAULT_MANIFEST = `${ARTIFACT_DIR}/release-metadata.json`;
const HEX_64_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;

function fail(message, exitCode = 1) {
  console.error(`ERROR: ${message}`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    requireArtifactMetadata: false,
    selectedRouteFlag: false,
    selectedRoute: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--manifest') {
      args.manifest = argv[++index] ?? fail('missing value for --manifest');
      continue;
    }
    if (token === '--require-artifact-metadata') {
      args.requireArtifactMetadata = true;
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
    return {
      absolutePath,
      data: JSON.parse(text),
    };
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

function normalizeRoute(args) {
  if (!args.selectedRouteFlag) {
    return ROUTE_ID;
  }

  const routeId = args.selectedRoute ?? ROUTE_ID;
  if (routeId !== ROUTE_ID) {
    fail(`unsupported selected route: ${routeId}; only ${ROUTE_ID} is implemented`, 2);
  }
  return routeId;
}

function computeSha256(filePath) {
  const fileBuffer = readFileSync(filePath);
  return createHash('sha256').update(fileBuffer).digest('hex');
}

function fileExistsRelative(relativePath) {
  if (!ensureNonEmptyString(relativePath)) {
    return false;
  }
  return existsSync(resolveFromRoot(relativePath));
}

function validateNodeCoreBoundaries(boundaries, errors, label) {
  if (!Array.isArray(boundaries) || boundaries.length < 2) {
    errors.push(`${label} must list at least the session and daemon private Node boundaries`);
    return;
  }

  const sources = new Set();
  for (const boundary of boundaries) {
    if (!isPlainObject(boundary)) {
      errors.push(`${label} entries must be objects`);
      continue;
    }
    if (!ensureNonEmptyString(boundary.id)) {
      errors.push(`${label} entry id must be a non-empty string`);
    }
    if (!ensureNonEmptyString(boundary.adapter)) {
      errors.push(`${label} entry adapter must be a non-empty string`);
    }
    if (!ensureNonEmptyString(boundary.source)) {
      errors.push(`${label} entry source must be a non-empty string`);
    } else {
      sources.add(boundary.source);
    }
  }

  if (!sources.has('src/index.js')) {
    errors.push(`${label} must include src/index.js as a private Node session boundary`);
  }
  if (!sources.has('src/browser.js')) {
    errors.push(`${label} must include src/browser.js as a private Node daemon boundary`);
  }
}

function validateReleaseManifest(manifest, expectedRouteId, requireArtifactMetadata) {
  const errors = [];

  if (!isPlainObject(manifest)) {
    return ['release manifest must be an object'];
  }

  if (manifest.schemaVersion !== 1) {
    errors.push('schemaVersion must be 1');
  }
  if (manifest.kind !== 'native-cli-release-manifest') {
    errors.push('kind must be native-cli-release-manifest');
  }
  if (manifest.releaseMode !== 'dry-run-local') {
    errors.push('releaseMode must be dry-run-local');
  }
  if (!ensureNonEmptyString(manifest.packageName)) {
    errors.push('packageName must be a non-empty string');
  }
  if (!ensureNonEmptyString(manifest.version) || !VERSION_PATTERN.test(manifest.version)) {
    errors.push('version must be a non-empty semver-like string');
  }
  if (manifest.routeId !== expectedRouteId) {
    errors.push(`routeId must be ${expectedRouteId}`);
  }
  if (!ensureNonEmptyString(manifest.artifactId)) {
    errors.push('artifactId must be a non-empty string');
  }
  if (!ensureNonEmptyString(manifest.artifactDir)) {
    errors.push('artifactDir must be a non-empty string');
  }
  if (!ensureNonEmptyString(manifest.artifactPath)) {
    errors.push('artifactPath must be a non-empty string');
  }
  if (!ensureNonEmptyString(manifest.buildManifestPath)) {
    errors.push('buildManifestPath must be a non-empty string');
  }
  if (manifest.daemonStrategy !== DAEMON_STRATEGY) {
    errors.push(`daemonStrategy must be ${DAEMON_STRATEGY}`);
  }

  if (!isPlainObject(manifest.checksum)) {
    errors.push('checksum must be an object');
  } else {
    if (manifest.checksum.algorithm !== 'sha256') {
      errors.push('checksum.algorithm must be sha256');
    }
    if (!ensureNonEmptyString(manifest.checksum.value) || !HEX_64_PATTERN.test(manifest.checksum.value)) {
      errors.push('checksum.value must be a 64-character lowercase sha256 hex digest');
    }
  }

  if (!isPlainObject(manifest.installNotes)) {
    errors.push('installNotes must be an object');
  } else {
    if (!ensureNonEmptyString(manifest.installNotes.source)) {
      errors.push('installNotes.source must be a non-empty string');
    }
    if (!ensureNonEmptyString(manifest.installNotes.summary)) {
      errors.push('installNotes.summary must be a non-empty string');
    }
  }

  if (!isPlainObject(manifest.runtime)) {
    errors.push('runtime must be an object');
  } else {
    if (manifest.runtime.kind !== 'hybrid-private-node-core') {
      errors.push('runtime.kind must be hybrid-private-node-core');
    }
    if (manifest.runtime.nodeRuntime !== 'required') {
      errors.push('runtime.nodeRuntime must be required');
    }
    if (manifest.runtime.privateNodeCore !== true) {
      errors.push('runtime.privateNodeCore must be true');
    }
    if (!ensureNonEmptyString(manifest.runtime.note)) {
      errors.push('runtime.note must be a non-empty string');
    } else {
      const runtimeNote = manifest.runtime.note.toLowerCase();
      if (!runtimeNote.includes('private node') || !runtimeNote.includes('runtime')) {
        errors.push('runtime.note must explicitly mention the private Node core/runtime dependency');
      }
    }
  }

  validateNodeCoreBoundaries(manifest.nodeCoreBoundaries, errors, 'nodeCoreBoundaries');

  if (!requireArtifactMetadata) {
    return errors;
  }

  if (!fileExistsRelative(manifest.artifactPath)) {
    errors.push(`artifactPath does not exist: ${manifest.artifactPath}`);
  }
  if (!fileExistsRelative(manifest.buildManifestPath)) {
    errors.push(`buildManifestPath does not exist: ${manifest.buildManifestPath}`);
  }
  if (!fileExistsRelative(manifest.installNotes?.source)) {
    errors.push(`installNotes.source does not exist: ${manifest.installNotes?.source}`);
  }

  if (fileExistsRelative(manifest.artifactPath) && isPlainObject(manifest.checksum)) {
    const artifactChecksum = computeSha256(resolveFromRoot(manifest.artifactPath));
    if (artifactChecksum !== manifest.checksum.value) {
      errors.push(`checksum mismatch for ${manifest.artifactPath}`);
    }
  }

  if (fileExistsRelative(manifest.installNotes?.source)) {
    const installNotesText = readFileSync(resolveFromRoot(manifest.installNotes.source), 'utf8').toLowerCase();
    if (!installNotesText.includes('private node') || !installNotesText.includes('runtime')) {
      errors.push('install notes file must explicitly mention the private Node core/runtime dependency');
    }
  }

  if (fileExistsRelative(manifest.buildManifestPath)) {
    const buildManifest = loadJson(manifest.buildManifestPath).data;
    if (!isPlainObject(buildManifest)) {
      errors.push('build manifest must be an object');
    } else {
      if (buildManifest.routeId !== expectedRouteId) {
        errors.push(`build manifest routeId must be ${expectedRouteId}`);
      }
      if (buildManifest.daemonStrategy !== DAEMON_STRATEGY) {
        errors.push(`build manifest daemonStrategy must be ${DAEMON_STRATEGY}`);
      }
      if (buildManifest.artifactRunner !== manifest.artifactPath) {
        errors.push('build manifest artifactRunner must match release manifest artifactPath');
      }
    }
  }

  return errors;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const expectedRouteId = normalizeRoute(args);
  const manifestDocument = loadJson(args.manifest);
  const errors = validateReleaseManifest(
    manifestDocument.data,
    expectedRouteId,
    args.requireArtifactMetadata,
  );

  if (errors.length > 0) {
    fail(errors.join('; '));
  }

  console.log(
    `OK release-dry-run route=${manifestDocument.data.routeId} version=${manifestDocument.data.version} artifact=${manifestDocument.data.artifactPath}`,
  );
}

main();
