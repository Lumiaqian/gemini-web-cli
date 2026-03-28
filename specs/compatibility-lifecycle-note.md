# Lifecycle Compatibility Note

## Scope

- Legacy surface: `gemini_browser_info` plus the shared `src/index.js` -> `src/browser.js` daemon-backed session lifecycle.
- Native route: `hybrid-native-cli-node-core` keep-daemon lifecycle adapter.

## Continuity Preserved

- The selected route keeps the detached daemon as a private subsystem behind the native CLI boundary instead of folding or replacing it.
- `browser-info` still follows the MCP-era lifecycle shape: daemon `/health` probe first, daemon `/browser/acquire` second, then browser status reporting with the acquired WebSocket endpoint and PID.
- Reuse semantics remain daemon-owned: browser acquisition extends TTL reuse, and session disconnect still drops only the CDP client connection while leaving the browser process alive for later commands.
- TTL lifecycle metadata remains observable through daemon status fields, so downstream diagnostics keep the same operational model as the MCP era.

## Behavioral Tightening

- Stale lifecycle states now fail deterministically through the CLI machine contract instead of relying on implicit daemon/browser behavior.
- Invalid acquire payloads, offline-after-acquire status responses, and disconnected cached session handles are normalized as `browser-startup-failure` with explicit `reason` and `phase` details.
- Machine mode keeps lifecycle diagnostics on stderr while stdout remains reserved for the final JSON envelope.

## Impact Assessment

- Impact level: `minor`
- Caller-visible change: stale daemon or cached-session conditions now surface structured failure details earlier, which is additive for CLI automation and removes hanging ambiguity.
- Migration note: scripts that previously treated daemon/browser lifecycle failures as free-form MCP text should now read CLI envelope `error.category`, `error.details.reason`, and `error.details.phase`.

## Verification

- Happy path: `node scripts/test-integration.mjs --suite lifecycle --selected-route`
- Stale path: `node scripts/test-integration.mjs --suite lifecycle-stale --selected-route`
