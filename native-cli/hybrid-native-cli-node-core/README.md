# Hybrid Native CLI Node Core Scaffold

This directory is the Task 5 implementation area for the selected route `hybrid-native-cli-node-core`.

## Intent

- Keep the future native CLI shell under `native-cli/`.
- Keep the existing Node browser and daemon runtime private behind route-local bridge files.
- Keep the command tree and capability dispatch in the CLI shell layer.

## Layout

- `src/cli-dev-entry.mjs` - dev entrypoint for the scaffold shell.
- `src/shell/run-scaffold-command.mjs` - minimal shell-facing scaffold command.
- `src/node-core/session-bridge.mjs` - private bridge to `src/index.js`.
- `src/node-core/daemon-bridge.mjs` - private bridge to `src/browser.js`.
- `test/scaffold-test-entry.mjs` - route-local test entry for later `scripts/test-unit.mjs` wiring.

## Local Developer Flow

Build the deterministic dev artifact:

```bash
node scripts/build-cli.mjs --selected-route hybrid-native-cli-node-core
```

Run the route-local scaffold test entry:

```bash
node native-cli/hybrid-native-cli-node-core/test/scaffold-test-entry.mjs
```

Run the same check through the frozen unit harness entrypoint:

```bash
node scripts/test-unit.mjs --suite selected-route-scaffold
```

Run the scaffold dev entry directly:

```bash
node native-cli/hybrid-native-cli-node-core/src/cli-dev-entry.mjs --describe-scaffold --json
```

Run the generated local build artifact after a build:

```bash
node dist/native-cli/hybrid-native-cli-node-core/run-dev.mjs --describe-scaffold --json
```

The generated artifact is a deterministic dev scaffold. It documents the boundary and local entrypoints, but it does not package a standalone native binary yet.
