# MCP to CLI parity matrix

Source of truth: `src/mcp-server.js`

Grouping hints: `README.md:249-295`

## Global runtime constraints

- `src/mcp-server.js` redirects non-JSON stdout writes to stderr and remaps `console.*` to stderr so MCP stdio stays machine-readable.
- Most tools share the same runtime chain: `src/mcp-server.js` -> `src/index.js:createGeminiSession()` -> `src/browser.js:ensureBrowser()` -> `src/gemini-ops.js:createOps(page)`.
- `src/browser.js` auto-starts the detached daemon when needed, acquires a CDP endpoint, finds or opens a Gemini tab, and `disconnect()` leaves the browser alive under daemon TTL control.
- Most handlers call `disconnect()` on controlled success/failure paths, but the code does not use `finally`, so uncaught mid-handler failures can skip cooperative cleanup.

## Summary

| Tool | Group | Migration | Long-running | Local file write | Notes |
| --- | --- | --- | --- | --- | --- |
| `gemini_generate_image` | `core-image-generation` | `must-have-v1` | yes | yes | Login gate, can switch to Pro, `newSession=true` currently clicks new chat twice. |
| `gemini_new_chat` | `session-management` | `must-have-v1` | no | no | Fresh chat creation only. |
| `gemini_temp_chat` | `session-management` | `must-have-v1` | no | no | Auto-creates a blank chat before entering temp mode. |
| `gemini_switch_model` | `model-and-conversation` | `must-have-v1` | no | no | Switches `pro` / `quick` / `think`. |
| `gemini_send_message` | `model-and-conversation` | `must-have-v1` | yes | no | Waits synchronously for reply completion and returns the reply text directly. |
| `gemini_upload_images` | `image-operations` | `must-have-v1` | no | no | Reads local files and can leave partial uploads if later files fail. |
| `gemini_get_images` | `image-operations` | `must-have-v1` | no | no | Returns JSON metadata only, no download. |
| `gemini_extract_image` | `image-operations` | `must-have-v1` | no | yes | Extracts image data via canvas/fetch/CDP fallback and writes a local file. |
| `gemini_download_full_size_image` | `image-operations` | `must-have-v1` | yes | yes | Uses hover + CDP download interception and writes a local file. |
| `gemini_get_all_text_responses` | `text-response` | `must-have-v1` | no | no | Returns JSON for all text replies. |
| `gemini_get_latest_text_response` | `text-response` | `must-have-v1` | no | no | Returns the latest text reply directly. |
| `gemini_check_login` | `diagnostics-and-management` | `must-have-v1` | no | no | Reads login-bar state from the live page. |
| `gemini_probe` | `diagnostics-and-management` | `must-have-v1` | no | no | Returns structured UI availability and status JSON. |
| `gemini_reload_page` | `diagnostics-and-management` | `must-have-v1` | no | no | Reloads the current page with timeout control. |
| `gemini_navigate_to` | `session-management` | `must-have-v1` | no | no | Restricts navigation to `gemini.google.com`. |
| `gemini_browser_info` | `diagnostics-and-management` | `must-have-v1` | no | no | Direct daemon HTTP probe; `/browser/acquire` can extend TTL and launch/reuse the browser. |

## Detailed entries

### `gemini_generate_image`

- Capability group: `core-image-generation`
- Parameters: `prompt` (string, required), `newSession` (boolean, default `false`), `referenceImages` (string array, default `[]`), `fullSize` (boolean, default `false`), `timeout` (number, default `180000`)
- Outputs: success returns MCP text announcing the saved local file path; preview mode never returns raw base64 and writes a file under `config.outputDir`; failure returns MCP text with `isError=true`
- Side effects: daemon/browser auto-start through `createGeminiSession()`, login precheck, optional model switch to Pro, optional local reference-image uploads, local file write on success, cooperative `disconnect()` on normal paths
- Long-running notes: yes; synchronous blocking tool documented at 60-120s typical runtime and sensitive to long timeout budgets
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js:checkLogin()`, `ensureModelPro()`, `uploadImage()`, `generateImage()`
- Migration status: `must-have-v1` - core current capability with no concrete reason to defer
- Error modes: `not_logged_in`, `reference_upload_failed`, `generation_failed`, `execution_crash`

### `gemini_new_chat`

- Capability group: `session-management`
- Parameters: none
- Outputs: success returns confirmation text; failure returns MCP text with `isError=true`
- Side effects: daemon/browser auto-start, active tab reset to a fresh conversation, cooperative `disconnect()` on normal paths
- Long-running notes: no; short UI click only
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js` click path through `ops.click('newChatBtn')`
- Migration status: `must-have-v1` - public session reset command today
- Error modes: `new_chat_failed`, `execution_crash`

### `gemini_temp_chat`

- Capability group: `session-management`
- Parameters: none
- Outputs: success confirms temporary mode entry; failure returns MCP text with `isError=true`
- Side effects: daemon/browser auto-start, forced blank-chat creation before temp mode, active session switched to temporary mode, cooperative `disconnect()` on normal paths
- Long-running notes: no; short UI flow with stabilization sleeps
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js:click('newChatBtn')`, `clickTempChat()`
- Migration status: `must-have-v1` - current privacy-oriented public command
- Error modes: `precondition_new_chat_failed`, `temp_chat_failed`, `execution_crash`

### `gemini_switch_model`

- Capability group: `model-and-conversation`
- Parameters: `model` (enum `pro|quick|think`, required)
- Outputs: success confirms the selected model and may include the previous model; failure returns MCP text with `isError=true`
- Side effects: daemon/browser auto-start, changes the active model, cooperative `disconnect()` on normal paths
- Long-running notes: no; short menu interaction
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js:switchToModel(model)`
- Migration status: `must-have-v1` - public model control already exists
- Error modes: `model_menu_open_failed`, `model_option_not_found`, `execution_crash`

### `gemini_send_message`

- Capability group: `model-and-conversation`
- Parameters: `message` (string, required), `timeout` (number, default `120000`)
- Outputs: success returns the latest Gemini reply text directly; failure returns MCP text with `isError=true` and includes elapsed time
- Side effects: daemon/browser auto-start, fills the prompt box, clicks send, polls until the page returns to idle, cooperative `disconnect()` on normal paths
- Long-running notes: yes; documented as synchronous blocking text exchange, typical 10-60s runtime, timeout sensitive
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js:sendAndWait()`
- Migration status: `must-have-v1` - direct text conversation is a core current behavior
- Error modes: `fill_failed`, `send_click_failed`, `timeout`, `execution_crash`

### `gemini_upload_images`

- Capability group: `image-operations`
- Parameters: `images` (string array, required, minimum one path)
- Outputs: success confirms all uploads; failure returns MCP text with `isError=true`, the failing path, and partial success count when a later file fails
- Side effects: daemon/browser auto-start, local filesystem existence checks, file chooser interaction, prompt attachment without sending, possible partial uploads, cooperative `disconnect()` on normal paths
- Long-running notes: no, but upload waits are timeout-sensitive inside `uploadImage()`
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js:uploadImage(filePath)`
- Migration status: `must-have-v1` - reference-image workflows depend on it today
- Error modes: `file_not_found`, `upload_panel_click_failed`, `upload_image_failed`, `partial_batch_failure`, `execution_crash`

### `gemini_get_images`

- Capability group: `image-operations`
- Parameters: none
- Outputs: success returns JSON text for `{ total, newCount, images }`; failure returns MCP text with `isError=true`
- Side effects: daemon/browser auto-start, DOM metadata read only, cooperative `disconnect()` on normal paths
- Long-running notes: no
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js:getAllImages()`
- Migration status: `must-have-v1` - image enumeration is part of the current workflow
- Error modes: `no_loaded_images`, `execution_crash`

### `gemini_extract_image`

- Capability group: `image-operations`
- Parameters: `imageUrl` (string, required)
- Outputs: success announces the saved local file path; failure returns MCP text with `isError=true` and available detail text
- Side effects: daemon/browser auto-start, canvas/fetch/CDP extraction fallback, watermark-removal attempt, local file write, cooperative `disconnect()` on normal paths
- Long-running notes: no; not marked long-running, but it can traverse several fallback strategies
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js:extractImageBase64(imageUrl)`
- Migration status: `must-have-v1` - current local-extraction path compensates for transport limits
- Error modes: `missing_url`, `no_loaded_images`, `canvas_tainted`, `fetch_failed`, `cdp_request_failed`, `cdp_error`, `execution_crash`

### `gemini_download_full_size_image`

- Capability group: `image-operations`
- Parameters: `index` (optional zero-based number, defaults to latest image)
- Outputs: success reports selected image index, total image count, saved file path, and suggested filename; failure returns MCP text with `isError=true` and detail lines when available
- Side effects: daemon/browser auto-start, image scroll/hover, `Browser.setDownloadBehavior`, download-event listeners, local file write, in-place watermark removal attempt, cooperative `disconnect()` on normal paths
- Long-running notes: yes; documented as a synchronous 10-30s path and sensitive to timeout, hover, and download-event completion
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js:downloadFullSizeImage({ index, timeout })`
- Migration status: `must-have-v1` - distinct from preview extraction and already publicly documented
- Error modes: `no_loaded_images`, `index_out_of_range`, `full_size_download_btn_not_found`, `download_timeout`, `download_canceled`, `downloaded_file_not_found`, `execution_crash`

### `gemini_get_all_text_responses`

- Capability group: `text-response`
- Parameters: none
- Outputs: success returns JSON text for `{ ok, responses, total }`; failure returns MCP text with `isError=true`
- Side effects: daemon/browser auto-start, DOM text scrape only, cooperative `disconnect()` on normal paths
- Long-running notes: no
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js:getAllTextResponses()`
- Migration status: `must-have-v1` - public bulk text inspection exists today
- Error modes: `no_responses`, `execution_crash`

### `gemini_get_latest_text_response`

- Capability group: `text-response`
- Parameters: none
- Outputs: success returns the latest text reply directly; failure returns MCP text with `isError=true`
- Side effects: daemon/browser auto-start, DOM text scrape only, cooperative `disconnect()` on normal paths
- Long-running notes: no
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js:getLatestTextResponse()`
- Migration status: `must-have-v1` - current public accessor for the latest reply
- Error modes: `no_responses`, `execution_crash`

### `gemini_check_login`

- Capability group: `diagnostics-and-management`
- Parameters: none
- Outputs: success reports login state and inspected nav-bar text; failure returns MCP text with `isError=true`
- Side effects: daemon/browser auto-start, live DOM login-state probe, cooperative `disconnect()` on normal paths
- Long-running notes: no
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js:checkLogin()`
- Migration status: `must-have-v1` - explicit diagnostics gate for current workflows
- Error modes: `login_bar_not_found`, `execution_crash`

### `gemini_probe`

- Capability group: `diagnostics-and-management`
- Parameters: none
- Outputs: success returns structured page-state JSON text; failure returns MCP text with `isError=true` only on handler crash
- Side effects: daemon/browser auto-start, multi-selector DOM/status reads, cooperative `disconnect()` on normal paths
- Long-running notes: no
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js:probe()`, `getStatus()`, `getCurrentModel()`
- Migration status: `must-have-v1` - current public diagnostics surface needed for parity debugging
- Error modes: `execution_crash`

### `gemini_reload_page`

- Capability group: `diagnostics-and-management`
- Parameters: `timeout` (number, default `30000`)
- Outputs: success returns elapsed reload time; failure returns MCP text with `isError=true`
- Side effects: daemon/browser auto-start, full page reload with `networkidle2`, cooperative `disconnect()` on normal paths
- Long-running notes: no, but clearly timeout-sensitive
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js:reloadPage({ timeout })`
- Migration status: `must-have-v1` - page recovery is a current supported control path
- Error modes: `reload_failed`, `execution_crash`

### `gemini_navigate_to`

- Capability group: `session-management`
- Parameters: `url` (required URL string limited to `gemini.google.com`), `timeout` (number, default `30000`)
- Outputs: success returns final URL and elapsed time; failure returns MCP text with `isError=true` and available detail text
- Side effects: daemon/browser auto-start, browser navigation to a specific Gemini URL, domain whitelist enforcement, cooperative `disconnect()` on normal paths
- Long-running notes: no, but clearly timeout-sensitive
- Shared dependencies: `src/index.js:createGeminiSession()`, `src/browser.js:ensureBrowser()` and `disconnect()`, `src/gemini-ops.js:navigateTo(url, { timeout })`
- Migration status: `must-have-v1` - historical chat restoration is currently public and documented
- Error modes: `invalid_domain`, `navigate_failed`, `execution_crash`

### `gemini_browser_info`

- Capability group: `diagnostics-and-management`
- Parameters: none
- Outputs: success returns JSON text for daemon, browser, and config details; failure returns MCP text with `isError=true`
- Side effects: bypasses `createGeminiSession()`, calls daemon `/health` then `/browser/acquire`, can launch/reuse the browser and extend daemon TTL, exposes `wsEndpoint` and `pid`, and never calls `disconnect()` because it never opens Puppeteer
- Long-running notes: no, but guarded by short HTTP timeouts
- Shared dependencies: intentionally bypasses `src/index.js:createGeminiSession()`, still depends on the daemon contract enforced by `src/browser.js`, and does not use `src/gemini-ops.js`
- Migration status: `must-have-v1` - diagnostics remain essential while transport changes
- Error modes: `daemon_not_ready`, `daemon_unreachable`, `acquire_failed`
