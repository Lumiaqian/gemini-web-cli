# Smoke Fixtures

Smoke fixtures in this directory register route-neutral scenarios for `scripts/run-smoke.mjs`.

## Rules

- File location: `.sisyphus/specs/migrate-mcp-client-to-native-cli/fixtures/smoke/*.json`
- File naming: kebab-case scenario name with `.json`
- Schema marker: `kind` must be `cli-smoke-fixture`
- Route neutrality: `routeNeutral` must be `true`
- CI policy: `interactive: true` is allowed only as a negative-policy fixture; it is rejected when `CI=1` or `--require-noninteractive` is active
- Default discovery rule: `scripts/run-smoke.mjs` auto-loads smoke fixtures except files whose names start with `bad-`; negative-policy fixtures stay opt-in via `--fixture`

## Required Fields

```json
{
  "fixtureVersion": 1,
  "kind": "cli-smoke-fixture",
  "name": "example-smoke",
  "description": "Short scenario summary.",
  "routeNeutral": true,
  "interactive": false,
  "commandLine": {
    "binary": "<native-cli>",
    "subcommand": "send-message",
    "args": ["--json", "--timeout-ms", "60000"]
  },
  "execution": {
    "mode": "metadata-only",
    "timeoutMs": 60000,
    "requiresLogin": false,
    "notes": "Why this smoke exists and why Task 4 keeps it at registration or dry-run stage."
  },
  "expectations": {
    "stdoutContract": "json-only",
    "stderrContract": "diagnostics-only",
    "allowedTerminalStates": ["succeeded", "failed", "timed_out", "interrupted"]
  },
  "evidence": {
    "captureSource": "src/demo2.js",
    "reason": "Current repo behavior or constraint that motivated this scenario."
  }
}
```

## Current Negative Fixture

- `describe-scaffold-built-artifact.json` executes the built `dist/native-cli/.../run-dev.mjs` artifact in a CI-safe `--json` path, so smoke is no longer metadata-only.
- `send-message-noninteractive.json` is the default positive smoke fixture used by CI-safe dry-runs.
- `bad-smoke-interactive.json` exists specifically to prove that non-interactive CI enforcement is machine-verifiable.
- Use it with `CI=1 node scripts/run-smoke.mjs --fixture .sisyphus/specs/migrate-mcp-client-to-native-cli/fixtures/smoke/bad-smoke-interactive.json --dry-run --require-noninteractive`.
