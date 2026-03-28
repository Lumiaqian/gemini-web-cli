---
name: gemini-web-cli
description: 通过 Gemini 官网（gemini.google.com）执行生图、对话和浏览器诊断等自动化操作。用户提到“生图/画图/绘图/nano banana/nanobanana/生成图片”等关键词时触发。当前产品面向是 CLI-first，首选 `node scripts/run-cli.mjs ... --json`，次选仓库脚本。禁止自行启动外部浏览器访问 Gemini。
---

# Gemini Web CLI Skill

> CLI-first: 当前仓库的推荐主入口是 `node scripts/run-cli.mjs ... --json`。这是面向脚本、自动化流程和 CI 的默认接口。

## ⚠️ 操作优先级（必须遵守）

与 Gemini 的一切交互，按以下优先级选择方式：

1. **🥇 首选 CLI**，通过 `node scripts/run-cli.mjs ... --json` 调用当前仓库公开的 CLI 命令树，这是默认接口
2. **🥈 次选仓库脚本**，当现有 CLI 包装还没覆盖某些内部维护动作时，可运行仓库内已存在的脚本入口
3. **🥉 最后才是连接浏览器**，仅当前两种方式都无法解决时，可先通过 `node scripts/run-cli.mjs diagnostic browser-info --json` 获取连接信息，再主动连接到仓库管理的浏览器进行操作。**此方式必须先征得用户同意**

**绝对禁止**：自行启动新的浏览器实例访问 Gemini 页面，比如使用外部浏览器自动化、另起 Puppeteer，或绕过当前仓库的浏览器生命周期管理。这会导致会话冲突。

> 浏览器 Daemon 未运行时，CLI 或仓库脚本可能触发自动拉起，无需任何手动操作。

## 📡 进度同步 & 长耗时工具规则

CLI 命令或仓库脚本，尤其是生图、等待回复等操作，可能耗时较长，通常在 60 到 180 秒。必须遵守以下规则：

- **本 Skill 当前推荐的 CLI-first 调用是同步阻塞的**，会等到最终结果才返回，不存在“中间状态”需要轮询
- 调用长耗时命令时，`timeoutMs` 必须设为 ≥180000（3 分钟），避免传输层提前超时截断
- **禁止在未收到工具最终返回前结束对话**，也不要向用户报告“还在运行”或“工具超时”这种未落地的结论
- 每隔 15 到 30 秒向用户发送一条进度消息，比如“正在等待 Gemini 生成图片，已等待 30 秒”，保持反馈
- 拿到最终结果后**立即**回传产物，比如文件路径，或报告错误，不得遗漏
- 若 `fullSize` 模式失败，可降级重试 `fullSize=false`，预览图模式更稳定

## 触发关键词

- **生图任务**：`生图`、`画`、`绘图`、`海报`、`nano banana`、`nanobanana`、`image generation`、`生成图片`
- 若请求含糊，先确认用户是否需要生图

## 使用方式

当前默认使用方式是 CLI-first：

```bash
node scripts/run-cli.mjs --help
node scripts/run-cli.mjs diagnostic browser-info --json
node scripts/run-cli.mjs conversation send-message --message "你好" --json
```

浏览器启动、会话管理、图片提取、文件保存等流程，已封装在 CLI 和底层运行时内部。

### ⚠️ 强制规则

> **AI 必须优先通过 CLI-first 入口完成操作。**
>
> 禁止绕过 CLI/runtime 约束自行编写临时脚本，比如 `node -e "..."` 或创建 `.js` 临时文件，来
> `import` / `require` 本项目导出的函数，比如 `createGeminiSession`、`createOps` 等。
>
> 如果当前 CLI 入口确实无法满足需求，AI **必须先向用户说明原因并获得明确同意**，
> 才能退回到底层脚本或连接浏览器。未经用户同意，一律禁止。

## CLI-first 常用命令

- `node scripts/run-cli.mjs diagnostic browser-info --json`
- `node scripts/run-cli.mjs diagnostic check-login --json`
- `node scripts/run-cli.mjs conversation send-message --message "你好" --json`
- `node scripts/run-cli.mjs image generate-image --prompt "一只戴耳机的橘猫" --json --timeout-ms 180000`

## 失败处理

命令内部已包含重试逻辑。若仍然失败，返回值里的错误信息会告知原因：

- **生成超时**，建议用户简化描述词后重试
- **Daemon 未启动**，命令通常会自动拉起，若仍失败可手动 `npm run daemon`
- **页面异常**，可调用 `node scripts/run-cli.mjs diagnostic browser-info --json` 查看浏览器状态排查

## 参考

- 详细执行与回退：`references/gemini-flow.md`
- 关键词与路由：`references/intent-routing.md`
