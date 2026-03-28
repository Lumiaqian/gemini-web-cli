# Gemini Web CLI

[![npm version](https://img.shields.io/badge/npm-v1.0.2-blue.svg)](https://www.npmjs.com/package/@lumiaqian/gemini-web-cli)

Gemini Web CLI 是一个通过 CDP 驱动 Gemini 网页的命令行工具，面向脚本、自动化流程和 CI 场景，提供稳定的 JSON 机器输出、明确的退出码，以及围绕对话、生图和浏览器诊断的一组 CLI 命令。

当前选定路线是 `hybrid-native-cli-node-core`。CLI 负责命令树、机器模式 JSON 契约、退出码和发布编排，浏览器与 daemon 仍然由私有 Node core/runtime 提供。

## 当前状态

- 主入口: `gemini-web-cli`（全局安装后）或 `node scripts/run-cli.mjs`（源码）
- npm script 入口: `npm run cli --`
- 机器模式: `--json` 时 stdout 只输出一个 JSON 文档，诊断信息只走 stderr
- 选定路线: `hybrid-native-cli-node-core`
- daemon 策略: `keep`
- 发布形态: `dry-run-local`
- 运行时现实: 仍依赖 private Node core/runtime，不应被描述为完全独立的原生二进制

## 快速开始

### 1. 安装

**通过 npm 全局安装（推荐）**

```bash
npm install -g @lumiaqian/gemini-web-cli
```

安装后可以直接使用 `gemini-web-cli` 命令。

**从源码安装**

```bash
git clone https://github.com/Lumiaqian/gemini-web-cli.git
cd gemini-web-cli
npm install
```

### 2. 查看 CLI 命令树

```bash
gemini-web-cli --help
# 或源码: node scripts/run-cli.mjs --help
```

### 3. 用机器模式检查当前路由和命令树

```bash
gemini-web-cli describe-scaffold --json
# 或源码: node scripts/run-cli.mjs describe-scaffold --json
```

### 4. 执行真实 CLI 命令

```bash
gemini-web-cli diagnostic browser-info --json
gemini-web-cli conversation send-message --message "你好" --json
gemini-web-cli image generate-image --prompt "一只戴耳机的橘猫" --timeout-ms 180000 --json

# 源码模式:
# node scripts/run-cli.mjs diagnostic browser-info --json
# node scripts/run-cli.mjs conversation send-message --message "你好" --json
# node scripts/run-cli.mjs image generate-image --prompt "一只戴耳机的橘猫" --timeout-ms 180000 --json
```

## 安装与前置条件

- Node.js 18+
- Chrome、Edge 或 Chromium 之一
- 需要能访问 `gemini.google.com`
- 首次使用前，需要先在浏览器中登录 Google 账号

如果你需要固定浏览器位置或输出目录，可以通过环境变量或 `.env` 配置。

```env
# 浏览器路径，不设则自动检测 Chrome、Edge、Chromium
# BROWSER_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome

# CDP 调试端口
# BROWSER_DEBUG_PORT=40821

# 是否启用无头模式
# BROWSER_HEADLESS=false

# 图片输出目录
# OUTPUT_DIR=./gemini-image

# daemon HTTP 端口
# DAEMON_PORT=40225

# daemon 闲置超时，毫秒
# DAEMON_TTL_MS=1800000
```

配置优先级如下。

`flag > env > .env.development > .env > default`

## CLI 优先入口

项目同时提供原始脚本入口和 `package.json` 里的常用 alias，方便在本地开发、脚本编排和 CI 中统一调用。

### 运行 CLI

```bash
npm run cli -- --help
npm run cli -- --version
npm run cli -- describe-scaffold --json
```

对应的底层命令如下。

```bash
node scripts/run-cli.mjs --help
node scripts/run-cli.mjs --version
node scripts/run-cli.mjs describe-scaffold --json
```

### 构建本地 CLI 工件

```bash
npm run build
```

对应的底层命令如下。

```bash
node scripts/build-cli.mjs --selected-route hybrid-native-cli-node-core
```

构建后会生成本地 dev artifact。

```bash
node dist/native-cli/hybrid-native-cli-node-core/run-dev.mjs describe-scaffold --json
```

### 运行测试

```bash
npm test
npm run test:contract
npm run test:integration
npm run test:smoke
```

### 本地发布 dry run

```bash
npm run release:dry-run
```

对应的底层命令如下。

```bash
node scripts/release-dry-run.mjs --selected-route hybrid-native-cli-node-core --require-artifact-metadata
```

这个流程会验证 `dist/native-cli/hybrid-native-cli-node-core/release-metadata.json`，并要求 release metadata 继续显式声明 private Node core/runtime 依赖和 `dry-run-local` 发布模式。

### daemon 调试入口

```bash
npm run daemon
```

`daemon` 是内部子系统的调试与维护入口，不影响 CLI 作为主产品入口的定位。

## 命令分组

CLI 公开的是分组路径，同时保留了便于直接调用的平铺 alias。下面是当前命令树中的对应关系。

| CLI 路径 | 平铺 alias |
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

## 机器模式与退出码

脚本和 CI 应该优先使用 `--json`。

```bash
node scripts/run-cli.mjs diagnostic browser-info --json
```

机器模式遵循这些规则。

- stdout 只输出一个 JSON envelope
- stderr 只输出诊断、进度和恢复提示
- `exitCode` 字段必须和真实进程退出码一致
- 退出码遵循项目当前实现约定

当前稳定退出码类别如下。

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

## 架构现实

当前产品叙述必须反映真实实现，而不是未来想象图。

```text
scripts/run-cli.mjs
  -> native-cli/hybrid-native-cli-node-core/
  -> private Node session bridge to src/index.js
  -> private Node daemon bridge to src/browser.js
  -> detached daemon owns browser lifecycle and TTL reuse
```

这里最重要的现实约束如下。

- CLI 是第一入口，但底层仍是 hybrid wrapper
- detached daemon 仍然保留，并作为私有子系统存在
- `browser-info` 仍然遵循 daemon `/health` 和 `/browser/acquire` 的生命周期现实
- 构建与发布验证是本地 dry run，不是远程发布流程

## 注意事项

1. 首次运行真实 Gemini 命令时，需要浏览器已登录 Google 账号。
2. 同一 CDP 端口不要同时拉起多个浏览器实例。
3. `image generate-image` 和 `conversation send-message` 都是阻塞式命令，请根据场景设置 `--timeout-ms`。
4. 当前 CLI 优先面向脚本和 CI，`--json` 才是稳定契约。

## 致谢

本项目基于 [WJZ-P/gemini-skill](https://github.com/WJZ-P/gemini-skill) 改造而来，感谢原作者的出色工作。原项目提供了 Gemini 网页自动化的核心能力（CDP 驱动、会话管理、图片生成与提取、水印移除等），本项目在此基础上剥离了 MCP 相关代码，重构为纯 CLI 工具。

## 许可

本项目使用 MIT License，详见 `LICENSE`。
