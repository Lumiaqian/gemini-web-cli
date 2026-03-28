---
name: gemini-web-cli
description: >
  Drive Gemini web (gemini.google.com) via CDP for AI image generation, text conversations, and browser automation.
  Use this skill whenever the user wants to generate images with Gemini, have Gemini answer questions or summarize text,
  upload reference images for image-to-image workflows, download or extract Gemini-generated images, or manage Gemini
  sessions/models. Trigger on: 生图, 画图, 绘图, 生成图片, 海报, nano banana, image generation, draw, generate image,
  问Gemini, 让Gemini总结, Gemini对话, ask Gemini, Gemini chat — even when the user doesn't explicitly mention "Gemini"
  but implies AI image generation or wants to talk to Google's AI. Also use when the user mentions downloading full-size
  Gemini images, removing watermarks, or checking Gemini login status.
---

# Gemini Web CLI

This skill wraps a CLI tool that controls Google Gemini's web interface through CDP (Chrome DevTools Protocol). Every operation goes through `node scripts/run-cli.mjs <command> --json` — the `--json` flag ensures stdout contains only a machine-safe JSON envelope while diagnostics go to stderr, which makes output parsing reliable.

A background browser daemon manages the Chrome lifecycle: it auto-starts on first use, reuses the browser across commands, and shuts down after 30 minutes of inactivity. You never need to launch or manage a browser yourself — and you should not, because running a second browser instance would conflict with the daemon's session.

## Image Generation

The most common use case. Gemini image generation typically takes 60–180 seconds, so always set `--timeout-ms 180000` to avoid premature timeouts.

```bash
# Basic generation — returns a preview PNG with watermark removed
node scripts/run-cli.mjs generate-image --prompt "一只戴耳机的橘猫" --timeout-ms 180000 --json

# Full-size download — saves the highest resolution available, watermark auto-removed
node scripts/run-cli.mjs generate-image --prompt "一只戴耳机的橘猫" --full-size --timeout-ms 180000 --json

# With reference images — for style transfer or image-to-image
node scripts/run-cli.mjs generate-image --prompt "同风格的狗" --reference-images /path/to/ref.png --timeout-ms 180000 --json

# Start a fresh session first — avoids context pollution from previous conversations
node scripts/run-cli.mjs generate-image --prompt "日落山景" --new-session --timeout-ms 180000 --json
```

If `--full-size` fails (e.g., CDP fetch error), retry without it — preview mode is more resilient.

## Text Conversations

```bash
# Send a message and wait for Gemini's reply
node scripts/run-cli.mjs send-message --message "帮我总结这段文字" --json

# Read the latest response
node scripts/run-cli.mjs get-latest-text-response --json

# Read all responses in the session
node scripts/run-cli.mjs get-all-text-responses --json
```

For multi-step workflows (e.g., "ask Gemini about X, then generate an image"), run `send-message` first, then `generate-image` as separate commands.

## Image Operations

```bash
# List all images currently visible on the page
node scripts/run-cli.mjs get-images --json

# Download full-size version of an existing page image (latest by default)
node scripts/run-cli.mjs download-full-size-image --json
node scripts/run-cli.mjs download-full-size-image --index 0 --json

# Upload local images into the current prompt input area
node scripts/run-cli.mjs upload-images --images /path/a.png,/path/b.jpg --json

# Extract a specific image as base64
node scripts/run-cli.mjs extract-image --image-url "blob:https://gemini.google.com/xxx" --json
```

## Session & Model Management

```bash
node scripts/run-cli.mjs new-chat --json          # Start a blank conversation
node scripts/run-cli.mjs temp-chat --json          # Temporary chat (no history saved)
node scripts/run-cli.mjs navigate-to --url "https://gemini.google.com/app/xxx" --json
node scripts/run-cli.mjs switch-model --model pro --json
```

## Diagnostics

```bash
node scripts/run-cli.mjs check-login --json        # Is the user signed in to Google?
node scripts/run-cli.mjs browser-info --json        # Browser/daemon connection details
node scripts/run-cli.mjs probe --json               # Page element state snapshot
node scripts/run-cli.mjs reload-page --json         # Force reload the Gemini page
```

Before any real operation, `check-login` is worth running if you're unsure about auth state. If not logged in, tell the user to complete Google sign-in in the browser window that the daemon manages.

## Exit Codes

| Code | Meaning | What to do |
|-----:|---------|------------|
| 0 | Success | — |
| 2 | Bad arguments | Fix the command flags |
| 3 | Not logged in | Tell user to sign in to Google in the browser |
| 5 | Element not found | Try `reload-page`, then retry |
| 6 | Timeout | Simplify the prompt or increase `--timeout-ms` |
| 8 | Internal error | Check `browser-info` for daemon state |

## Constraints

- Every command must include `--json` for reliable output parsing.
- Never launch a browser yourself, write temporary scripts to import internal APIs, or use screenshots to capture images. All operations go through the CLI.
- The daemon auto-starts — if a command fails with a connection error, just retry and it will spawn.
