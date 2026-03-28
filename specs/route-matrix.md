# Native CLI Route Matrix

## Bottom Line

The weighted matrix selects `hybrid-native-cli-node-core` with a score of `85.20`, ahead of `go-rewrite` at `53.20` and `rust-rewrite` at `48.80`.

The daemon choice is explicit: keep the detached daemon model as a private subsystem behind the native CLI instead of folding it into each command or replacing it during the first migration wave.

## Inputs Used

- Capability baseline: `.sisyphus/specs/migrate-mcp-client-to-native-cli/parity-matrix.json`
- Machine contract baseline: `.sisyphus/specs/migrate-mcp-client-to-native-cli/cli-contract.md`
- Runtime chain: `src/mcp-server.js` -> `src/index.js:createGeminiSession()` -> `src/browser.js:ensureBrowser()` -> `src/gemini-ops.js`
- Daemon lifecycle facts: `src/browser.js`, `src/daemon/server.js`, `src/daemon/handlers.js`, `src/daemon/lifecycle.js`, `src/daemon/engine.js`

Repo facts that most affect the route decision:

- Fifteen public tools rely on the shared `createGeminiSession()` path.
- `gemini_browser_info` is the exception and already bypasses `createGeminiSession()` to call daemon HTTP endpoints directly.
- The current browser stack depends on `puppeteer-extra-plugin-stealth` and Chrome profile cloning before first launch.
- The current daemon is detached, HTTP-addressable, TTL-driven, and intentionally keeps the browser alive after `disconnect()`.
- Machine mode now requires exactly one JSON envelope on stdout, while current contamination hazards come from browser/daemon `console.log(...)` calls and the `process.stdout.write(...)` polling pattern in `src/demo2.js`.

## Scoring Model

Scale: `1` to `5`, where higher is better.

Weighted total formula:

```text
weighted_total = sum(weight * raw_score / 5)
```

| Criterion | Weight | Why it matters here |
| --- | ---: | --- |
| `delivery-risk` | 24 | Later tasks are blocked by this choice, so near-term parity risk dominates. |
| `puppeteer-cdp-reuse` | 18 | Current behavior already lives in Node automation, stealth, and daemon code. |
| `packaging-quality` | 10 | Native delivery matters, but not more than parity and contract safety. |
| `runtime-performance` | 8 | Useful, but browser latency still dominates user-visible runtime. |
| `maintainability` | 14 | The selected route becomes the long-term operating model. |
| `testability` | 8 | Later contract, parity, integration, and smoke harnesses must attach cleanly. |
| `release-complexity` | 8 | CI and multi-platform publishing must stay reproducible. |
| `daemon-lifecycle-migration-complexity` | 10 | Current daemon semantics are public enough to constrain the migration. |

## Route Scores

| Route | Daemon strategy | Delivery risk | Reuse | Packaging | Performance | Maintainability | Testability | Release | Daemon/lifecycle | Total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `go-rewrite` | `replace` | 2 | 1 | 5 | 4 | 3 | 3 | 4 | 2 | 53.20 |
| `rust-rewrite` | `fold` | 1 | 1 | 4 | 5 | 4 | 4 | 3 | 1 | 48.80 |
| `hybrid-native-cli-node-core` | `keep` | 5 | 5 | 3 | 3 | 4 | 4 | 3 | 5 | 85.20 |

## Route Analysis

### `go-rewrite`

- Best eventual single-binary packaging story.
- Good performance ceiling and distribution tooling.
- Low reuse of the current Puppeteer, stealth, daemon, and profile-clone implementation.
- Must rebuild daemon semantics that `browser-info` already exposes directly today.
- Chosen daemon strategy: `replace`, because keeping the Node daemon defeats the rewrite goal and folding the lifecycle would lose TTL reuse.

### `rust-rewrite`

- Strong native packaging and long-term systems-level performance ceiling.
- Better theoretical maintainability than Go only after a full browser runtime exists.
- Lowest near-term reuse because the current implementation is entirely Node-based.
- Folding lifecycle into each command conflicts with the current detached-daemon and `browser-info` model.
- Chosen daemon strategy: `fold`, to represent the most packaging-centric Rust route, even though it scores worst on lifecycle migration fit.

### `hybrid-native-cli-node-core`

- Keeps the shared Node browser core that already implements stealth, CDP, profile clone, TTL reuse, and daemon health/acquire/release behavior.
- Preserves the `browser-info` exception instead of redesigning it while other parity work is still pending.
- Lets the native CLI shell focus first on machine-mode JSON envelopes, exit codes, stderr-only diagnostics, and packaging orchestration.
- Packaging is weaker than a pure rewrite, but the risk reduction is large enough that the weighted matrix still wins decisively.
- Chosen daemon strategy: `keep`, because the current detached daemon is already the lowest-risk way to preserve parity.

## Daemon Comparison

| Strategy | What it means here | Main upside | Main downside |
| --- | --- | --- | --- |
| `keep` | Retain the detached daemon and hide it behind the native CLI. | Preserves current parity, TTL reuse, and `browser-info` semantics. | Mixed-runtime packaging remains more complex. |
| `fold` | Remove the detached daemon and let each CLI command own browser lifecycle. | Simpler topology on paper and no standing helper process. | Loses TTL reuse, makes `browser-info` awkward, and reintroduces cold starts for every command. |
| `replace` | Build a new supervisor in the selected route language. | Can preserve the long-lived browser model without shipping the existing daemon forever. | Requires reimplementing lifecycle, stealth-adjacent behavior, and diagnostics while parity work is still incomplete. |

Final daemon choice: `keep` for the selected `hybrid-native-cli-node-core` route.

Why `keep` wins now:

- `browser-info` already depends on daemon HTTP behavior directly, so keeping the daemon avoids a compatibility shim before Task 4+.
- The detached lifecycle isolates long-lived browser ownership from one-shot CLI invocations, which matches the single JSON stdout contract from Task 2.
- Existing `console.log(...)` noise can be redirected to stderr in the wrapper without rewriting browser behavior first.

## Final Selection

Selected route: `hybrid-native-cli-node-core`

Selected daemon strategy: `keep`

Reasoning:

- It preserves the current product behavior where the repo is most specialized: Puppeteer/CDP orchestration, stealth plugin usage, Chrome profile cloning, detached daemon lifecycle, and the `browser-info` direct-daemon exception.
- It keeps the first migration wave small enough to finish safely: native command surface, machine envelope, exit codes, packaging, and verification.
- It avoids pulling Task 4+ implementation work into Task 3 by not forcing a rewrite of lifecycle semantics yet.

## Deterministic Tie-Break Rule

Use the exact weighted formula above on the unrounded raw scores.

If the top two weighted totals differ by more than `2.00` points, select the higher total.

If the top two weighted totals differ by `2.00` points or less:

1. Prefer the route with the higher `delivery-risk` score.
2. If that preferred route has `maintainability < 3`, reject that preference and keep the other route instead.
3. If still tied, prefer the route with the higher `daemon-lifecycle-migration-complexity` score.
4. If still tied, prefer the route with the higher `maintainability` score.
5. If still tied, pick the lexicographically smaller route id.

This matrix does not need the tie-break because `hybrid-native-cli-node-core` leads by `32.00` points over the runner-up.
