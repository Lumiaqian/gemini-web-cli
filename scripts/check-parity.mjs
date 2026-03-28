#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_MATRIX = 'specs/parity-matrix.json';
const SOURCE_ALIASES = {
  cli: 'native-cli/hybrid-native-cli-node-core/src/command-tree.mjs',
};

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    source: null,
    matrix: null,
    expectedCount: null,
    requireClassification: false,
    compare: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--source') {
      args.source = argv[++i] ?? fail('missing value for --source');
      continue;
    }
    if (token === '--matrix') {
      args.matrix = argv[++i] ?? fail('missing value for --matrix');
      continue;
    }
    if (token === '--expected-count') {
      const value = argv[++i] ?? fail('missing value for --expected-count');
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        fail(`invalid --expected-count value: ${value}`);
      }
      args.expectedCount = parsed;
      continue;
    }
    if (token === '--require-classification') {
      args.requireClassification = true;
      continue;
    }
    if (token === '--compare') {
      const value = argv[++i] ?? fail('missing value for --compare');
      if (value !== 'matrix') {
        fail(`unsupported --compare target: ${value}`);
      }
      args.compare = value;
      continue;
    }

    fail(`unknown argument: ${token}`);
  }

  if (!args.source && !args.matrix) {
    args.matrix = DEFAULT_MATRIX;
  }
  if (args.source && !args.matrix) {
    args.matrix = DEFAULT_MATRIX;
  }

  return args;
}

function resolveFromRoot(inputPath) {
  return path.resolve(process.cwd(), inputPath);
}

function loadText(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    fail(`unable to read ${filePath}: ${error.message}`);
  }
}

function resolveSourcePath(sourceArg) {
  const mapped = SOURCE_ALIASES[sourceArg] ?? sourceArg;
  return resolveFromRoot(mapped);
}

function extractSourceToolNames(sourceText) {
  const regex = /server\.registerTool\(\s*["']([^"']+)["']/g;
  const names = [];
  let match = regex.exec(sourceText);
  while (match) {
    names.push(match[1]);
    match = regex.exec(sourceText);
  }
  return names;
}

async function extractCliMappedToolNames(sourcePath) {
  let module;
  try {
    module = await import(pathToFileURL(sourcePath).href);
  } catch (error) {
    fail(`unable to import ${sourcePath}: ${error.message}`);
  }

  if (typeof module.listParityMappedLegacyTools !== 'function') {
    fail(`cli source ${sourcePath} does not export listParityMappedLegacyTools()`);
  }

  const names = module.listParityMappedLegacyTools();
  if (!Array.isArray(names) || names.some((name) => !ensureNonEmptyString(name))) {
    fail(`cli source ${sourcePath} returned an invalid mapped legacy tool list`);
  }

  return names;
}

async function extractSourceNames(sourceArg, sourcePath) {
  if (sourceArg === 'cli') {
    return extractCliMappedToolNames(sourcePath);
  }

  const sourceText = loadText(sourcePath);
  return extractSourceToolNames(sourceText);
}

function ensureNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateMatrix(matrix, { requireClassification }) {
  const errors = [];

  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    errors.push('matrix root must be an object');
    return errors;
  }

  if (!Number.isInteger(matrix.toolCount)) {
    errors.push('matrix.toolCount must be an integer');
  }

  if (!Array.isArray(matrix.tools)) {
    errors.push('matrix.tools must be an array');
    return errors;
  }

  if (Number.isInteger(matrix.toolCount) && matrix.toolCount !== matrix.tools.length) {
    errors.push(`matrix.toolCount (${matrix.toolCount}) does not match tools.length (${matrix.tools.length})`);
  }

  const seenNames = new Set();
  const requiredFields = [
    'name',
    'capabilityGroup',
    'parameters',
    'outputs',
    'sideEffects',
    'longRunningNotes',
    'sharedEntrypointDependencies',
    'errorModes',
    'migrationStatus',
  ];

  matrix.tools.forEach((tool, index) => {
    const label = `tools[${index}]`;

    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
      errors.push(`${label} must be an object`);
      return;
    }

    for (const field of requiredFields) {
      if (!(field in tool)) {
        errors.push(`${label}.${field} is required`);
      }
    }

    if (!ensureNonEmptyString(tool.name)) {
      errors.push(`${label}.name must be a non-empty string`);
    } else if (seenNames.has(tool.name)) {
      errors.push(`duplicate tool name: ${tool.name}`);
    } else {
      seenNames.add(tool.name);
    }

    if (!ensureNonEmptyString(tool.capabilityGroup)) {
      errors.push(`${label}.capabilityGroup must be a non-empty string`);
    }

    if (!Array.isArray(tool.parameters)) {
      errors.push(`${label}.parameters must be an array`);
    }

    if (!tool.outputs || typeof tool.outputs !== 'object' || Array.isArray(tool.outputs)) {
      errors.push(`${label}.outputs must be an object`);
    }

    if (!Array.isArray(tool.sideEffects)) {
      errors.push(`${label}.sideEffects must be an array`);
    }

    if (!tool.longRunningNotes || typeof tool.longRunningNotes !== 'object' || Array.isArray(tool.longRunningNotes)) {
      errors.push(`${label}.longRunningNotes must be an object`);
    }

    if (!Array.isArray(tool.sharedEntrypointDependencies) || tool.sharedEntrypointDependencies.length === 0) {
      errors.push(`${label}.sharedEntrypointDependencies must be a non-empty array`);
    }

    if (!Array.isArray(tool.errorModes)) {
      errors.push(`${label}.errorModes must be an array`);
    }

    if (!tool.migrationStatus || typeof tool.migrationStatus !== 'object' || Array.isArray(tool.migrationStatus)) {
      errors.push(`${label}.migrationStatus must be an object`);
    } else {
      if (!ensureNonEmptyString(tool.migrationStatus.reason)) {
        errors.push(`${label}.migrationStatus.reason must be a non-empty string`);
      }
      if (requireClassification && !ensureNonEmptyString(tool.migrationStatus.classification)) {
        errors.push(`${label}.migrationStatus.classification must be a non-empty string when --require-classification is set`);
      }
    }
  });

  return errors;
}

function compareNames(sourceNames, matrixNames) {
  const sourceSet = new Set(sourceNames);
  const matrixSet = new Set(matrixNames);

  const missing = sourceNames.filter((name) => !matrixSet.has(name));
  const unexpected = matrixNames.filter((name) => !sourceSet.has(name));

  return { missing, unexpected };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let matrixPath = null;
  let matrix = null;
  if (args.matrix) {
    matrixPath = resolveFromRoot(args.matrix);
    const matrixText = loadText(matrixPath);
    try {
      matrix = JSON.parse(matrixText);
    } catch (error) {
      fail(`invalid JSON in ${matrixPath}: ${error.message}`);
    }
  }

  if (matrix) {
    const matrixErrors = validateMatrix(matrix, {
      requireClassification: args.requireClassification,
    });
    if (matrixErrors.length > 0) {
      fail(matrixErrors.join('; '));
    }
  }

  let sourceNames = null;
  let sourcePath = null;
  if (args.source) {
    sourcePath = resolveSourcePath(args.source);
    sourceNames = await extractSourceNames(args.source, sourcePath);

    if (args.expectedCount !== null && sourceNames.length !== args.expectedCount) {
      fail(`source tool count mismatch for ${sourcePath}: expected ${args.expectedCount}, got ${sourceNames.length}`);
    }

    const duplicates = sourceNames.filter((name, index) => sourceNames.indexOf(name) !== index);
    if (duplicates.length > 0) {
      fail(`duplicate source tool names found: ${[...new Set(duplicates)].join(', ')}`);
    }
  }

  if (matrix && sourceNames) {
    const matrixNames = matrix.tools.map((tool) => tool.name);
    const { missing, unexpected } = compareNames(sourceNames, matrixNames);
    if (missing.length > 0 || unexpected.length > 0) {
      const parts = [];
      if (missing.length > 0) {
        parts.push(`missing from matrix: ${missing.join(', ')}`);
      }
      if (unexpected.length > 0) {
        parts.push(`unexpected in matrix: ${unexpected.join(', ')}`);
      }
      fail(parts.join('; '));
    }
  }

  const summary = [];
  if (sourceNames) {
    summary.push(`source=${path.relative(process.cwd(), sourcePath)}:${sourceNames.length}`);
  }
  if (matrix) {
    summary.push(`matrix=${path.relative(process.cwd(), matrixPath)}:${matrix.tools.length}`);
  }
  if (args.requireClassification) {
    summary.push('classification=required');
  }
  if (args.compare) {
    summary.push(`compare=${args.compare}`);
  }

  console.log(`OK ${summary.join(' ')}`.trim());
}

await main();
