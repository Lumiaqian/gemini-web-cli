# Route-Neutral Test Harness

## Purpose

- Task 4 establishes one validation surface that Go, Rust, and Hybrid routes can all plug into without changing the harness entrypoint names.
- The harness treats the current repo as a behavior-capture source, not as the final implementation under test.
- Until a real native CLI runner exists, dry-run output and fixture validation are the stable contract for the harness itself.

## Entry Points

| Entrypoint | Role now | Route-neutral plug-in point later |
| --- | --- | --- |
| `scripts/check-parity.mjs` | Validates the Task 1 parity matrix against the current MCP inventory. | Later tasks can swap the source side from MCP-only capture to CLI mapping evidence without changing the harness contract. |
| `scripts/test-contract.mjs` | Validates the Task 2 machine-envelope fixtures and stdout cleanliness. | Later tasks can add more contract fixture sets without changing the script name or fixture envelope shape. |
| `scripts/check-route-matrix.mjs` | Validates the Task 3 route-decision matrix and daemon decision. | Later tasks can keep the same validation gate even if only one route is being implemented. |
| `scripts/test-unit.mjs` | Unified unit-level harness that registers `check-parity` and `test-contract`. | Later tasks can add route-specific unit suites behind the same `--suite` interface. |
| `scripts/test-integration.mjs` | Unified integration harness that registers `check-route-matrix` and smoke-fixture registration. | Later tasks can replace smoke dry-run registration with real CLI integration execution under the same suite ids. |
| `scripts/run-smoke.mjs` | Validates smoke fixtures, enumerates planned smoke scenarios, and enforces CI non-interactive policy. | Later tasks can bind fixture execution to a real CLI runner without changing fixture locations or the CI policy flag. |
| `scripts/final-audit.mjs` | Aggregates final verification modes: `plan-compliance`, `quality-review`, `e2e-regression`, `scope-fidelity`. | Final Verification Wave can plug real evidence collection into the existing mode names. |

## Fixture Layout

| Location | Purpose |
| --- | --- |
| `.sisyphus/specs/migrate-mcp-client-to-native-cli/fixtures/contract-success.json` | Happy-path machine-envelope fixture validated by `scripts/test-contract.mjs`. |
| `.sisyphus/specs/migrate-mcp-client-to-native-cli/fixtures/contract-failure.json` | Failure-path machine-envelope fixture validated by `scripts/test-contract.mjs`. |
| `.sisyphus/specs/migrate-mcp-client-to-native-cli/fixtures/bad-contract-stdout-pollution.json` | Negative fixture proving stdout contamination is rejected. |
| `.sisyphus/specs/migrate-mcp-client-to-native-cli/fixtures/bad-parity-missing-classification.json` | Negative fixture proving missing migration classification is rejected. |
| `.sisyphus/specs/migrate-mcp-client-to-native-cli/fixtures/bad-route-matrix-missing-daemon-decision.json` | Negative fixture proving daemon-decision completeness is enforced. |
| `.sisyphus/specs/migrate-mcp-client-to-native-cli/fixtures/smoke/*.json` | Route-neutral smoke registration fixtures used by `scripts/run-smoke.mjs`. |

## Smoke Fixture Conventions

- Smoke fixtures live only under `.sisyphus/specs/migrate-mcp-client-to-native-cli/fixtures/smoke/`.
- Each smoke fixture must declare `routeNeutral: true` so the scenario stays portable across implementation routes.
- `interactive: true` is allowed for registration and negative-policy testing, but it is rejected whenever `CI=1` or `--require-noninteractive` is active.
- Default smoke discovery excludes files named `bad-*.json`, so the default CI-safe dry-run path exercises positive fixtures while explicit negative-policy checks still use `--fixture`.
- Smoke fixtures register command shape, timeout budget, expected stdout/stderr policy, and provenance from current repo behavior such as `src/demo.js` or `src/demo2.js`.
- Task 4 stops at fixture registration and dry-run planning on purpose; no smoke fixture may require live Gemini access to pass dry-run verification.

## Workflow

1. `scripts/test-unit.mjs` verifies the frozen baseline artifacts from Tasks 1 and 2.
2. `scripts/test-integration.mjs` verifies the route decision from Task 3 and confirms smoke scenarios are registered.
3. `scripts/run-smoke.mjs` lists or validates smoke fixtures and applies CI non-interactive policy.
4. `scripts/final-audit.mjs` rolls the same checks into auditable modes used by later verification waves.

## Commands

```bash
node scripts/test-unit.mjs --dry-run
node scripts/test-integration.mjs --dry-run
node scripts/run-smoke.mjs --dry-run
node scripts/final-audit.mjs --dry-run
CI=1 node scripts/run-smoke.mjs --fixture .sisyphus/specs/migrate-mcp-client-to-native-cli/fixtures/smoke/bad-smoke-interactive.json --dry-run --require-noninteractive
```

## Final Audit Modes

- `plan-compliance`: confirms the Task 4 harness files exist and the harness docs still mention fixture locations plus `check-parity`, `test-contract`, and `check-route-matrix`.
- `quality-review`: runs the unit and integration harnesses.
- `e2e-regression`: runs the smoke harness in route-neutral registration mode.
- `scope-fidelity`: reruns the Task 1-3 validators directly so later work cannot silently drift from the frozen baseline.
