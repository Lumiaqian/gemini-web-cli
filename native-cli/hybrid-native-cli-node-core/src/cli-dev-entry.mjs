#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchHybridNativeCliCommand } from './shell/dispatch-command.mjs';

export async function runHybridNativeCliScaffold(argv, io) {
  return dispatchHybridNativeCliCommand(argv, io);
}

const entryFilePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (invokedPath === entryFilePath) {
  const exitCode = await runHybridNativeCliScaffold(process.argv.slice(2));
  if (Number.isInteger(exitCode)) {
    process.exit(exitCode);
  }
}
