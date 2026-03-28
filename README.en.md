# Gemini Web CLI

Gemini Web CLI is a CLI tool that drives the Gemini web interface via CDP, designed for scripts, automation workflows and CI scenarios. It provides stable JSON machine output, explicit exit codes, and a suite of CLI commands for conversation, image generation and browser diagnostics.

The selected route is `hybrid-native-cli-node-core`. The CLI handles the command tree, machine-mode JSON contract, exit codes and release orchestration, while the browser and daemon continue to be provided by a private Node core/runtime.

## Current Status

- Primary entry: `node scripts/run-cli.mjs`
- npm script entry: `npm run cli --`
- Machine mode: `--json` makes stdout output only a single JSON document, diagnostics go only to stderr
- Selected route: `hybrid-native-cli-node-core`
- Daemon strategy: `keep`
- Release mode: `dry-run-local`
- Runtime reality: still depends on private Node core/runtime; should not be described as a fully standalone native binary

## Quick Start

### 1. Installation

**Install via npm (recommended)**

```bash
npm install -g gemini-web-cli
```

After installation, the `gemini-web-cli` command is available globally.

**Install from source**

```bash
git clone https://github.com/Lumiaqian/gemini-web-cli.git
cd gemini-web-cli
npm install
```

### 2. View CLI Command Tree

```bash
node scripts/run-cli.mjs --help
```

### 3. Check Current Route and Command Tree in Machine Mode

```bash
node scripts/run-cli.mjs describe-scaffold --json
```

### 4. Run Real CLI Commands

```bash
node scripts/run-cli.mjs diagnostic browser-info --json
node scripts/run-cli.mjs conversation send-message --message "Hello" --json
node scripts/run-cli.mjs image generate-image --prompt "A ginger cat wearing headphones" --timeout-ms 180000 --json
```

## Prerequisites

- Node.js 18+
- Chrome, Edge or Chromium
- Access to `gemini.google.com`
- A Google account signed in through the target browser profile on first use

To pin browser location or output directory, configure via environment variables or `.env`.

```env
# Browser executable path; auto-detects Chrome, Edge, Chromium if unset
# BROWSER_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome

# CDP remote debugging port
# BROWSER_DEBUG_PORT=40821

# Headless mode (true / false)
# BROWSER_HEADLESS=false

# Image output directory
# OUTPUT_DIR=./gemini-image

# Daemon HTTP port
# DAEMON_PORT=40225

# Daemon idle timeout in milliseconds
# DAEMON_TTL_MS=1800000
```

Priority: `flag > env > .env.development > .env > default`

## CLI-first Entry Points

The project provides both raw script entry points and convenient aliases in `package.json`.

### Run CLI

```bash
npm run cli -- --help
npm run cli -- --version
npm run cli -- describe-scaffold --json
```

Equivalent raw commands:

```bash
node scripts/run-cli.mjs --help
node scripts/run-cli.mjs --version
node scripts/run-cli.mjs describe-scaffold --json
```

### Build Local CLI Artifact

```bash
npm run build
```

Equivalent raw command:

```bash
node scripts/build-cli.mjs --selected-route hybrid-native-cli-node-core
```

After build, a local dev artifact is generated:

```bash
node dist/native-cli/hybrid-native-cli-node-core/run-dev.mjs describe-scaffold --json
```

### Run Tests

```bash
npm test
npm run test:contract
npm run test:integration
npm run test:smoke
```

### Local Release Dry Run

```bash
npm run release:dry-run
```

Equivalent raw command:

```bash
node scripts/release-dry-run.mjs --selected-route hybrid-native-cli-node-core --require-artifact-metadata
```

This validates `dist/native-cli/hybrid-native-cli-node-core/release-metadata.json` and requires the release metadata to explicitly declare private Node core/runtime dependency and `dry-run-local` release mode.

### Daemon Debug Entry

```bash
npm run daemon
```

The daemon entry is for debugging and maintaining the internal subsystem; it does not affect CLI as the primary product entry point.

## Command Groups

CLI exposes grouped paths while also providing flat aliases for direct invocation. Below is the mapping:

| CLI Path | Flat Alias |
| --- | --- |
| `session new-chat` | `new-chat` |
| `session temp-chat` | `temp-chat` |
| `session navigate-to` | `navigate-to` |
| `model switch-model` | `switch-model` |
| `conversation send-message` | `send-message` |
| `image generate-image` | `generate-image` |
| `image upload-images` | `upload-images` |
| `image get-images` | `get-images` |
| `image extract-image` | `extract-image` |
| `image download-full-size-image` | `download-full-size-image` |
| `text get-all-text-responses` | `get-all-text-responses` |
| `text get-latest-text-response` | `get-latest-text-response` |
| `diagnostic check-login` | `check-login` |
| `diagnostic probe` | `probe` |
| `diagnostic reload-page` | `reload-page` |
| `diagnostic browser-info` | `browser-info` |

## Machine Mode and Exit Codes

Scripts and CI should prefer `--json`.

```bash
node scripts/run-cli.mjs diagnostic browser-info --json
```

Machine mode follows these rules:

- stdout outputs exactly one JSON envelope
- stderr outputs only diagnostics, progress and recovery hints
- The `exitCode` field must match the actual process exit code
- Exit codes follow the project's current conventions

Stable exit code categories:

| Category | Exit Code |
| --- | ---: |
| `success` | 0 |
| `invalid-args` | 2 |
| `auth-failure` | 3 |
| `browser-startup-failure` | 4 |
| `selector-failure` | 5 |
| `timeout` | 6 |
| `interrupted` | 7 |
| `internal-error` | 8 |

## Architecture Reality

Product description must reflect the actual implementation, not future plans.

```text
scripts/run-cli.mjs
  -> native-cli/hybrid-native-cli-node-core/
  -> private Node session bridge to src/index.js
  -> private Node daemon bridge to src/browser.js
  -> detached daemon owns browser lifecycle and TTL reuse
```

Key reality constraints:

- CLI is the primary entry point, but the implementation is still a hybrid wrapper
- Detached daemon remains as a private subsystem
- `browser-info` still follows the daemon `/health` and `/browser/acquire` lifecycle reality
- Build and release validation is a local dry run, not a remote release pipeline

## Notes

1. On first real run, the browser requires a Google account to be signed in.
2. Do not spawn multiple browser instances on the same CDP port simultaneously.
3. `image generate-image` and `conversation send-message` are blocking commands; set `--timeout-ms` appropriately.
4. CLI-first is designed for scripts and CI; `--json` is the stable contract.

## Acknowledgments

This project is based on [WJZ-P/gemini-skill](https://github.com/WJZ-P/gemini-skill). Huge thanks to the original author for building the core Gemini web automation capabilities — CDP-driven browser control, session management, image generation and extraction, watermark removal, and more. This project strips out MCP-related code and restructures it as a pure CLI tool.

## License

MIT License. See `LICENSE` for details.
