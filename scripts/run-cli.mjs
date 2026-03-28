#!/usr/bin/env node

import { runHybridNativeCliScaffold } from '../native-cli/hybrid-native-cli-node-core/src/cli-dev-entry.mjs';

const exitCode = await runHybridNativeCliScaffold(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
});

if (Number.isInteger(exitCode)) {
  process.exit(exitCode);
}
