# Selected Route Scaffold

Task 5 scaffolds only the selected route `hybrid-native-cli-node-core` with daemon strategy `keep`.

## Scope

- Add a route-local implementation area under `native-cli/hybrid-native-cli-node-core/`.
- Keep shell-facing files separate from the legacy Node browser core.
- Add a deterministic build entry at `scripts/build-cli.mjs`.
- Expose a route-local test entry for later harness wiring without changing the frozen route-neutral entrypoint names.
- Document local build, test, and run steps.

## Boundary

- Shell-facing files live only under `native-cli/hybrid-native-cli-node-core/src/`.
- `native-cli/hybrid-native-cli-node-core/src/node-core/session-bridge.mjs` owns the direct import from `src/index.js`.
- `native-cli/hybrid-native-cli-node-core/src/node-core/daemon-bridge.mjs` owns the direct import from `src/browser.js`.
- The shell layer imports only route-local metadata and bridge descriptors, so the native shell concern stays isolated from the existing Node core/runtime code.

## Build Entry

`scripts/build-cli.mjs` accepts `--selected-route` with either:

- no explicit value, which falls back to `.sisyphus/specs/migrate-mcp-client-to-native-cli/route-matrix.json` final selection
- an explicit value, which must be `hybrid-native-cli-node-core`

On success it writes a deterministic dev artifact under `dist/native-cli/hybrid-native-cli-node-core/`:

- `manifest.json` - selected route metadata and source entrypoint references
- `run-dev.mjs` - local wrapper that executes the route-local scaffold shell

On an unsupported route it fails non-zero with the deterministic error code label `invalid-route` in stderr output.

## Test Entry

The route-local test entry is:

- `native-cli/hybrid-native-cli-node-core/test/scaffold-test-entry.mjs`

The unified harness now registers it as unit suite id `selected-route-scaffold` via `scripts/test-unit.mjs` without changing the frozen harness entrypoint name.

It verifies:

- route metadata stays pinned to `hybrid-native-cli-node-core`
- daemon strategy stays pinned to `keep`
- implementation files exist in the route-local area
- shell files do not reach directly into `src/`
- bridge files remain the explicit ownership seam into `src/index.js` and `src/browser.js`

## Developer Setup

Install repo dependencies first:

```bash
npm install
```

Build, test, and inspect the scaffold locally:

```bash
node scripts/build-cli.mjs --selected-route hybrid-native-cli-node-core
node scripts/test-unit.mjs --suite selected-route-scaffold
node native-cli/hybrid-native-cli-node-core/test/scaffold-test-entry.mjs
node native-cli/hybrid-native-cli-node-core/src/cli-dev-entry.mjs --describe-scaffold --json
node dist/native-cli/hybrid-native-cli-node-core/run-dev.mjs --describe-scaffold --json
```

## Deferred Work

- No root command tree exists yet.
- No MCP capability handlers are migrated yet.
- No runtime stdout/stderr hardening is applied yet beyond documenting the seam.
- No packaging or release automation is implemented yet.
