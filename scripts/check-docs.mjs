#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_DOCS = 'README.md';
const DEFAULT_MANIFEST = 'package.json';
const DEFAULT_REPORT = 'specs/compatibility-report.md';
const DEFAULT_PARITY_MATRIX = 'specs/parity-matrix.json';
const COMMAND_BLOCK_LABELS = new Set(['', 'bash', 'sh', 'shell', 'zsh', 'console']);

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    docs: DEFAULT_DOCS,
    manifest: DEFAULT_MANIFEST,
    report: DEFAULT_REPORT,
    parityMatrix: DEFAULT_PARITY_MATRIX,
    requireCliPrimary: false,
    requireCompatReport: false,
    detectStaleScripts: false,
    detectMissingDeps: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--docs') {
      args.docs = argv[++index] ?? fail('missing value for --docs');
      continue;
    }
    if (token === '--manifest') {
      args.manifest = argv[++index] ?? fail('missing value for --manifest');
      continue;
    }
    if (token === '--report') {
      args.report = argv[++index] ?? fail('missing value for --report');
      continue;
    }
    if (token === '--parity-matrix') {
      args.parityMatrix = argv[++index] ?? fail('missing value for --parity-matrix');
      continue;
    }
    if (token === '--require-cli-primary') {
      args.requireCliPrimary = true;
      continue;
    }
    if (token === '--require-compat-report') {
      args.requireCompatReport = true;
      continue;
    }
    if (token === '--detect-stale-scripts') {
      args.detectStaleScripts = true;
      continue;
    }
    if (token === '--detect-missing-deps') {
      args.detectMissingDeps = true;
      continue;
    }

    fail(`unknown argument: ${token}`);
  }

  return args;
}

function resolveFromRoot(relativePath) {
  return path.resolve(process.cwd(), relativePath);
}

function loadText(relativePath) {
  const absolutePath = resolveFromRoot(relativePath);
  try {
    return {
      absolutePath,
      text: readFileSync(absolutePath, 'utf8'),
    };
  } catch (error) {
    fail(`unable to read ${absolutePath}: ${error.message}`);
  }
}

function loadJson(relativePath) {
  const { absolutePath, text } = loadText(relativePath);
  try {
    return {
      absolutePath,
      data: JSON.parse(text),
    };
  } catch (error) {
    fail(`invalid JSON in ${absolutePath}: ${error.message}`);
  }
}

function ensureIncludes(text, needle, message, errors) {
  if (!text.includes(needle)) {
    errors.push(message);
  }
}

function collectMatches(regex, text) {
  const matches = [];
  let match = regex.exec(text);
  while (match) {
    matches.push(match);
    match = regex.exec(text);
  }
  return matches;
}

function extractCommandBlocks(docsText) {
  const blocks = [];

  for (const match of collectMatches(/```([^\n`]*)\n([\s\S]*?)```/g, docsText)) {
    const label = (match[1] ?? '').trim().toLowerCase();
    if (COMMAND_BLOCK_LABELS.has(label)) {
      blocks.push(match[2]);
    }
  }

  return blocks;
}

function extractCommandLikeText(docsText) {
  const inlineSpans = docsText
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:[-*+]\s+|\d+\.\s+)?`([^`\n]+)`\s*$/))
    .filter(Boolean)
    .map((match) => match[1]);
  return [...extractCommandBlocks(docsText), ...inlineSpans].join('\n');
}

function normalizePackageToken(token) {
  const cleaned = token.trim();
  if (!cleaned || cleaned.startsWith('-')) {
    return null;
  }
  if (cleaned === '&&' || cleaned === '||') {
    return null;
  }
  if (cleaned.startsWith('.') || cleaned.startsWith('/')) {
    return null;
  }
  if (cleaned.includes('://')) {
    return null;
  }
  if (cleaned === 'npm' || cleaned === 'node' || cleaned === 'npx') {
    return null;
  }
  return cleaned;
}

function extractReferencedScripts(docsText) {
  const commandText = extractCommandLikeText(docsText);
  const matches = collectMatches(/npm[ \t]+run[ \t]+([A-Za-z0-9:_-]+)/g, commandText);
  return [...new Set(matches.map((match) => match[1]))];
}

function extractReferencedPackages(docsText) {
  const packages = new Set();
  const commandText = extractCommandLikeText(docsText);

  for (const match of collectMatches(/npm[ \t]+(?:install|i)[ \t]+([^\n`]+)/g, commandText)) {
    const rawList = match[1].trim();
    for (const token of rawList.split(/\s+/)) {
      const normalized = normalizePackageToken(token);
      if (normalized) {
        packages.add(normalized);
      }
    }
  }

  for (const match of collectMatches(/npx[ \t]+([@A-Za-z0-9._/-]+)/g, commandText)) {
    const normalized = normalizePackageToken(match[1]);
    if (normalized) {
      packages.add(normalized);
    }
  }

  return [...packages];
}

function validateCliPrimary(docsText, errors) {
  const cliSectionIndex = docsText.indexOf('## CLI 优先入口');

  if (cliSectionIndex === -1) {
    errors.push('docs must contain a CLI-primary section heading: "## CLI 优先入口"');
  }

  ensureIncludes(docsText, 'node scripts/run-cli.mjs', 'docs must present node scripts/run-cli.mjs as the primary CLI entrypoint', errors);
  ensureIncludes(docsText, '--json', 'docs must mention the machine-mode --json contract', errors);
  ensureIncludes(
    docsText,
    'node scripts/build-cli.mjs --selected-route hybrid-native-cli-node-core',
    'docs must mention the selected-route build command',
    errors,
  );
  ensureIncludes(
    docsText,
    'node scripts/release-dry-run.mjs --selected-route hybrid-native-cli-node-core --require-artifact-metadata',
    'docs must mention the local release dry-run command',
    errors,
  );
  ensureIncludes(docsText, 'private Node core/runtime', 'docs must explicitly mention the private Node core/runtime dependency', errors);
  ensureIncludes(docsText, 'dry-run-local', 'docs must explicitly mention dry-run-local release reality', errors);
}

function validateCompatReport(reportPath, reportText, parityMatrix, errors) {
  if (!existsSync(resolveFromRoot(reportPath))) {
    errors.push(`compatibility report is missing: ${reportPath}`);
    return;
  }

  ensureIncludes(reportText, 'hybrid-native-cli-node-core', 'compatibility report must mention the selected route id', errors);
  ensureIncludes(reportText, 'private Node core/runtime', 'compatibility report must mention the private Node core/runtime dependency', errors);
  ensureIncludes(reportText, 'dry-run-local', 'compatibility report must mention the dry-run-local release mode', errors);
  ensureIncludes(reportText, 'machine-mode', 'compatibility report must mention machine-mode output behavior', errors);

  if (parityMatrix && typeof parityMatrix === 'object' && !Array.isArray(parityMatrix)) {
    const toolCount = parityMatrix.toolCount;
    if (!Number.isInteger(toolCount) || toolCount <= 0) {
      errors.push('parity matrix must declare a positive toolCount when validating the compatibility report');
    }
  }
}

function validateReferencedScripts(docsText, manifest, errors) {
  const referencedScripts = extractReferencedScripts(docsText);
  const scripts = manifest?.scripts && typeof manifest.scripts === 'object' ? manifest.scripts : {};

  for (const scriptName of referencedScripts) {
    if (!(scriptName in scripts)) {
      errors.push(`docs reference missing npm script: ${scriptName}`);
    }
  }
}

function validateReferencedPackages(docsText, manifest, errors) {
  const declaredPackages = new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
    ...Object.keys(manifest?.optionalDependencies ?? {}),
    ...Object.keys(manifest?.peerDependencies ?? {}),
  ]);

  for (const packageName of extractReferencedPackages(docsText)) {
    if (!declaredPackages.has(packageName)) {
      errors.push(`docs reference package not declared in manifest: ${packageName}`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const docs = loadText(args.docs);
  const manifest = loadJson(args.manifest);
  const parityMatrix = loadJson(args.parityMatrix).data;
  const report = args.requireCompatReport || args.report ? loadText(args.report) : { text: '' };

  const errors = [];

  if (args.requireCliPrimary) {
    validateCliPrimary(docs.text, errors);
  }
  if (args.requireCompatReport) {
    validateCompatReport(args.report, report.text, parityMatrix, errors);
  }
  if (args.detectStaleScripts) {
    validateReferencedScripts(docs.text, manifest.data, errors);
  }
  if (args.detectMissingDeps) {
    validateReferencedPackages(docs.text, manifest.data, errors);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`ERROR: ${error}`);
    }
    process.exit(1);
  }

  console.log(`OK docs=${args.docs} manifest=${args.manifest}`);
}

main();
