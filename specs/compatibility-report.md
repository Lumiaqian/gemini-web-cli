# CLI 迁移兼容性影响报告

## 范围

本报告覆盖当前 `src/mcp-server.js` 暴露的全部 16 个 MCP 工具，并说明它们在原生 CLI 路线 `hybrid-native-cli-node-core` 下的映射、影响级别和已知漂移点。

本报告只陈述当前仓库已经实现或已经明确冻结的现实。

- 主入口已经改为 CLI first
- machine-mode 契约以 `--json` 为准
- daemon 继续保留，作为 private subsystem
- 发布流程当前只支持 `dry-run-local`
- 当前交付物仍依赖 private Node core/runtime，不是完全独立的 native binary

## 总体结论

从 MCP 调用迁移到 CLI 调用，对现有自动化调用方属于 `breaking` 变更，因为入口从 JSON-RPC tool call 改成了命令行命令加 JSON envelope。

不过，底层运行时语义尽量保持连续。

- 大多数能力仍沿用 `src/index.js -> src/browser.js -> src/gemini-ops.js`
- `browser-info` 仍保留 direct daemon lifecycle reality
- daemon TTL 复用语义继续存在
- 长耗时命令仍然是阻塞式终态命令，不提供 stdout 流式进度契约

## 所有 MCP 工具到 CLI 的映射

| Legacy MCP tool | CLI 路径 | CLI alias | 能力组 | 影响级别 | 主要影响 |
| --- | --- | --- | --- | --- | --- |
| `gemini_generate_image` | `image generate-image` | `generate-image` | `core-image-generation` | `breaking` | 调用方式从 MCP tool 改为 CLI 命令，成功结果改为 JSON envelope 中的 `result` 文件元数据。 |
| `gemini_new_chat` | `session new-chat` | `new-chat` | `session-management` | `breaking` | tool 名不再直接调用，返回改为 CLI envelope。 |
| `gemini_temp_chat` | `session temp-chat` | `temp-chat` | `session-management` | `breaking` | 同上，且仍保留先建空白 chat 再进 temp 的行为。 |
| `gemini_navigate_to` | `session navigate-to` | `navigate-to` | `session-management` | `breaking` | CLI 在命令层明确拒绝非 `gemini.google.com` URL。 |
| `gemini_switch_model` | `model switch-model` | `switch-model` | `model-and-conversation` | `breaking` | 参数从 tool input 改为命令参数，输出改为 JSON。 |
| `gemini_send_message` | `conversation send-message` | `send-message` | `model-and-conversation` | `breaking` | 回复文本不再直接作为 MCP text 返回，而是进入 `result`。 |
| `gemini_upload_images` | `image upload-images` | `upload-images` | `image-operations` | `breaking` | 命令参数改为 CLI flags 或 positional，输出进入 `result.uploadedCount` 等结构。 |
| `gemini_get_images` | `image get-images` | `get-images` | `image-operations` | `breaking` | 图片元信息仍可取回，但位置改到 CLI envelope 的 `result`。 |
| `gemini_extract_image` | `image extract-image` | `extract-image` | `image-operations` | `breaking` | 本地文件写入语义保留，脚本方需要改读 `result.output`。 |
| `gemini_download_full_size_image` | `image download-full-size-image` | `download-full-size-image` | `image-operations` | `breaking` | 保留全尺寸下载语义，但结果结构从自由文本变成 JSON。 |
| `gemini_get_all_text_responses` | `text get-all-text-responses` | `get-all-text-responses` | `text-response` | `breaking` | 多条文本回复仍可读，输出改为 `result.responses`。 |
| `gemini_get_latest_text_response` | `text get-latest-text-response` | `get-latest-text-response` | `text-response` | `breaking` | 最新回复文本改在 `result.text` 或等价结构中消费。 |
| `gemini_check_login` | `diagnostic check-login` | `check-login` | `diagnostics-and-management` | `breaking` | 登录态仍可探测，但不再返回 MCP text。 |
| `gemini_probe` | `diagnostic probe` | `probe` | `diagnostics-and-management` | `breaking` | 结构化探针信息继续保留，输出位置改到 CLI `result`。 |
| `gemini_reload_page` | `diagnostic reload-page` | `reload-page` | `diagnostics-and-management` | `breaking` | reload timeout 行为保留，返回改为 envelope。 |
| `gemini_browser_info` | `diagnostic browser-info` | `browser-info` | `diagnostics-and-management` | `breaking` | 仍然直接依赖 daemon 生命周期，但调用面改为 CLI。 |

## 共享兼容性变化

### 1. 输入变化

- legacy MCP 调用方传递的是 tool input object
- native CLI 调用方传递的是命令路径、alias、flags 和 positional args
- 机械映射规则仍然保持一致，去掉 `gemini_` 前缀，再把 `_` 变成 `-`

### 2. 输出变化

- legacy MCP 里，很多成功和失败是自由文本或 JSON 字符串
- native CLI 里，machine-mode 固定为一个 JSON envelope
- 脚本和 CI 需要改为读取 `result`、`error`、`exitCode`、`execution` 字段

### 3. stdout 和 stderr

- legacy MCP 依赖 stdio guard，避免污染 JSON-RPC
- native CLI 在 `--json` 下把 stdout 保留给最终 JSON，这也是当前 machine-mode 的稳定约束
- 所有进度、生命周期日志和恢复提示都应只走 stderr

### 4. 退出码

稳定退出码来自 `.sisyphus/specs/migrate-mcp-client-to-native-cli/exit-codes.json`。

| 类别 | 退出码 |
| --- | ---: |
| `success` | 0 |
| `invalid-args` | 2 |
| `auth-failure` | 3 |
| `browser-startup-failure` | 4 |
| `selector-failure` | 5 |
| `timeout` | 6 |
| `interrupted` | 7 |
| `internal-error` | 8 |

### 5. 运行时连续性

- 大多数命令仍复用共享 Node browser core
- daemon 仍是 keep 模式，不折叠成每个命令各自的浏览器生命周期
- `browser-info` 仍是直接触达 daemon `/health` 和 `/browser/acquire` 的例外路径
- 本地文件写入、副作用、超时敏感等待、登录前置检查都仍是兼容性评估的一部分

## 按工具的兼容性说明

### `gemini_generate_image` -> `image generate-image`

- 影响级别: `breaking`
- 输入变化: `prompt`、`newSession`、`referenceImages`、`fullSize`、`timeout` 从 tool 参数改为 CLI 参数
- 输出变化: 不再依赖 MCP 文本提示保存路径，脚本方应读取 `result.output` 和图像语义字段
- 行为保留: 登录检查、可选参考图上传、本地文件写入、长超时等待
- 迁移说明: 需要把旧的 tool 调用替换为 `node scripts/run-cli.mjs image generate-image ... --json`

### `gemini_new_chat` -> `session new-chat`

- 影响级别: `breaking`
- 输入变化: 无
- 输出变化: 成功与失败都改为 JSON envelope
- 行为保留: 创建全新聊天

### `gemini_temp_chat` -> `session temp-chat`

- 影响级别: `breaking`
- 输入变化: 无
- 输出变化: 成功与失败都改为 JSON envelope
- 行为保留: 仍然保留先创建空白 chat 再进入 temp 的现有流程

### `gemini_navigate_to` -> `session navigate-to`

- 影响级别: `breaking`
- 输入变化: `url` 和 `timeout` 改为 CLI 参数
- 输出变化: 结果进入 `result`
- 行为收紧: 非 `gemini.google.com` URL 会在命令层直接返回 `invalid-args`

### `gemini_switch_model` -> `model switch-model`

- 影响级别: `breaking`
- 输入变化: `model` 通过 `--model` 或 positional 指定
- 输出变化: 改为 JSON envelope
- 行为保留: `pro`、`quick`、`think` 三类选择仍保留

### `gemini_send_message` -> `conversation send-message`

- 影响级别: `breaking`
- 输入变化: `message`、`timeout` 改为 CLI 参数
- 输出变化: 回复文本不再直接作为 tool 文本返回
- 行为保留: 同步等待 Gemini 回复完成，超时仍敏感

### `gemini_upload_images` -> `image upload-images`

- 影响级别: `breaking`
- 输入变化: `images` 通过 `--images` 或 positional 指定
- 输出变化: 上传结果改为结构化字段
- 行为保留: 仍然会读本地文件，也仍然可能出现部分上传后失败

### `gemini_get_images` -> `image get-images`

- 影响级别: `breaking`
- 输入变化: 无
- 输出变化: 元信息从 MCP JSON 文本变为 CLI `result`
- 行为保留: 只读图片元信息，不下载文件

### `gemini_extract_image` -> `image extract-image`

- 影响级别: `breaking`
- 输入变化: `imageUrl` 改为 CLI 参数
- 输出变化: 文件输出进入结构化结果
- 行为保留: 仍有 canvas、fetch、CDP fallback 和本地写文件语义

### `gemini_download_full_size_image` -> `image download-full-size-image`

- 影响级别: `breaking`
- 输入变化: `index` 改为 CLI 参数
- 输出变化: 结果改为结构化 JSON
- 行为保留: hover、CDP 下载拦截、本地写文件、超时敏感下载等待

### `gemini_get_all_text_responses` -> `text get-all-text-responses`

- 影响级别: `breaking`
- 输入变化: 无
- 输出变化: 改为 `result.responses`
- 行为保留: 仍为只读文本抓取

### `gemini_get_latest_text_response` -> `text get-latest-text-response`

- 影响级别: `breaking`
- 输入变化: 无
- 输出变化: 改为结构化 `result`
- 行为保留: 仍返回最后一条文本回复

### `gemini_check_login` -> `diagnostic check-login`

- 影响级别: `breaking`
- 输入变化: 无
- 输出变化: 登录态报告改为 CLI envelope
- 行为保留: 仍基于页面状态探测登录情况

### `gemini_probe` -> `diagnostic probe`

- 影响级别: `breaking`
- 输入变化: 无
- 输出变化: 页面探针 JSON 改为 envelope 内结果
- 行为保留: 仍会读取 selector、状态和模型信息

### `gemini_reload_page` -> `diagnostic reload-page`

- 影响级别: `breaking`
- 输入变化: `timeout` 改为 CLI 参数
- 输出变化: 改为结构化结果
- 行为保留: 仍按 timeout 控制 reload

### `gemini_browser_info` -> `diagnostic browser-info`

- 影响级别: `breaking`
- 输入变化: 无
- 输出变化: daemon 和 browser 状态改为 envelope
- 行为保留: 仍是直接 daemon probe 路径，不走常规 session handler
- 额外说明: 当前 keep-daemon 路线下，这个命令最能体现 hybrid runtime reality

## 已知漂移点与处理结论

### 1. `npm run demo` 文档漂移

- 现状: 老 README 提过 `npm run demo`
- 仓库现实: 当前 `package.json` 只有 `mcp` 和 `daemon`
- 处理: 已从 README 删除，并改成 `node scripts/run-cli.mjs`、`node scripts/build-cli.mjs`、`node scripts/release-dry-run.mjs`

### 2. CLI 文档与 npm scripts 不一致

- 现状: CLI 已有独立入口脚本，但还没有新的 npm script 名称
- 处理: README 明确使用 `node scripts/...` 作为当前稳定入口
- 影响: 文档不能假装存在 `npm run cli` 或 `npm run build-cli`

### 3. 发布形态描述漂移

- 现状: 迁移目标是原生 CLI，但当前 release metadata 仍是 `dry-run-local`
- 处理: README 和本报告都明确说明当前只是本地 dry run 发布验证
- 影响: 不再暗示已经具备远程发布或完整原生打包

### 4. 运行时描述漂移

- 现状: 现在仍然依赖 private Node core/runtime
- 处理: README 和本报告都明确说明 hybrid wrapper reality
- 影响: 文档不能再把当前工件写成 fully standalone native binary

### 5. stdout 污染风险

- 现状: 底层 legacy browser 和 daemon 代码历史上有 `console.log(...)` 风险
- 处理: CLI shell 在机器模式下做 stdout guard，把杂音重定向到 stderr
- 影响: 对 `--json` 调用方来说，stdout 契约已被文档化并由 runtime guard 保护，但底层 private Node code 仍然是需要持续关注的 caveat

## 对下游调用方的迁移建议

1. 不要再把 MCP tool 名当成长期稳定入口。
2. 脚本和 CI 调用一律迁到 `node scripts/run-cli.mjs ... --json`。
3. 把旧逻辑里对 MCP 文本消息的解析，迁到 `result`、`error`、`exitCode` 和 `execution` 字段。
4. 对于浏览器和 daemon 异常，优先读取 `error.category`、`error.details.reason`、`error.details.phase`。
5. 如果你依赖发布工件，请把当前工件视为本地 dry run 验证产物，而不是远程可发布的完全独立原生二进制。

## 验证入口

- `node scripts/check-parity.mjs --source mcp-server --expected-count 16 --require-classification`
- `node scripts/check-parity.mjs --source cli --compare matrix`
- `node scripts/test-contract.mjs --fixtures contract`
- `node scripts/build-cli.mjs --selected-route hybrid-native-cli-node-core`
- `node scripts/release-dry-run.mjs --selected-route hybrid-native-cli-node-core --require-artifact-metadata`
- `node scripts/check-docs.mjs --require-cli-primary --require-compat-report`

## 证据来源

- `src/mcp-server.js`
- `.sisyphus/specs/migrate-mcp-client-to-native-cli/parity-matrix.md`
- `.sisyphus/specs/migrate-mcp-client-to-native-cli/parity-matrix.json`
- `.sisyphus/specs/migrate-mcp-client-to-native-cli/cli-contract.md`
- `.sisyphus/specs/migrate-mcp-client-to-native-cli/route-matrix.md`
- `.sisyphus/specs/migrate-mcp-client-to-native-cli/compatibility-lifecycle-note.md`
- `native-cli/hybrid-native-cli-node-core/src/command-tree.mjs`
- `scripts/build-cli.mjs`
- `scripts/release-dry-run.mjs`
- `scripts/run-cli.mjs`
