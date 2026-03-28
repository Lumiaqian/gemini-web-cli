import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXIT_CODE_SPEC_PATH = path.resolve(
  RUNTIME_DIR,
  '../../../../specs/exit-codes.json'
);

const exitCodeSpec = Object.freeze(JSON.parse(readFileSync(EXIT_CODE_SPEC_PATH, 'utf8')));
const entriesByName = new Map(exitCodeSpec.codes.map((entry) => [entry.name, Object.freeze({ ...entry })]));
const entriesByExitCode = new Map(exitCodeSpec.codes.map((entry) => [entry.exitCode, entriesByName.get(entry.name)]));

export const EXIT_CODE_TABLE = Object.freeze({
  schemaVersion: exitCodeSpec.schemaVersion,
  defaultSuccessCode: exitCodeSpec.defaultSuccessCode,
  specPath: EXIT_CODE_SPEC_PATH,
  codes: Object.freeze(exitCodeSpec.codes.map((entry) => entriesByName.get(entry.name))),
});

export function listExitCodeEntries() {
  return EXIT_CODE_TABLE.codes.map((entry) => ({ ...entry }));
}

export function getExitCodeEntry(category) {
  return entriesByName.get(category) ?? entriesByName.get('internal-error');
}

export function getExitCodeForCategory(category) {
  return getExitCodeEntry(category).exitCode;
}

export function getExitCodeEntryByCode(exitCode) {
  return entriesByExitCode.get(exitCode) ?? entriesByName.get('internal-error');
}

export function buildExitCodeError(category, message, details = null) {
  const entry = getExitCodeEntry(category);
  return {
    category: entry.name,
    code: entry.name,
    message,
    retryable: entry.retryable,
    details,
  };
}
