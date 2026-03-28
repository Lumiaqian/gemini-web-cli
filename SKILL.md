---
name: gemini-web-cli
description: 通过 CDP 驱动 Gemini 网页执行 AI 生图、对话、图片提取等操作。触发词：生图、画图、绘图、生成图片、nano banana、问 Gemini、Gemini 对话。所有操作通过 CLI 命令完成，禁止自行启动浏览器。
---

# Gemini Web CLI Skill

通过 `node scripts/run-cli.mjs <command> --json` 驱动 Gemini 网页，输出机器安全的 JSON。

## 触发词

| 场景 | 关键词 |
|------|--------|
| 生图 | 生图、画、绘图、海报、生成图片、nano banana、image generation |
| 对话 | 问 Gemini、让 Gemini 总结、Gemini 帮我 |
| 混合 | 先问再画 → 拆成两步：先 send-message，再 generate-image |

## 命令速查

```bash
# 生图（预览模式，默认）
node scripts/run-cli.mjs generate-image --prompt "一只戴耳机的橘猫" --timeout-ms 180000 --json

# 生图（全尺寸下载 + 自动去水印）
node scripts/run-cli.mjs generate-image --prompt "一只戴耳机的橘猫" --full-size --timeout-ms 180000 --json

# 生图 + 参考图
node scripts/run-cli.mjs generate-image --prompt "同风格的狗" --reference-images /path/to/ref.png --json

# 新会话生图（避免上下文干扰）
node scripts/run-cli.mjs generate-image --prompt "日落山景" --new-session --json

# 下载页面上已有图片的全尺寸版本
node scripts/run-cli.mjs download-full-size-image --json
node scripts/run-cli.mjs download-full-size-image --index 0 --json

# 发消息 / 对话
node scripts/run-cli.mjs send-message --message "帮我总结这段文字" --json

# 获取回复
node scripts/run-cli.mjs get-latest-text-response --json
node scripts/run-cli.mjs get-all-text-responses --json

# 查看页面上的图片列表
node scripts/run-cli.mjs get-images --json

# 上传图片到当前输入框
node scripts/run-cli.mjs upload-images --images /path/a.png,/path/b.jpg --json

# 提取指定图片的 base64
node scripts/run-cli.mjs extract-image --image-url "blob:https://gemini.google.com/xxx" --json

# 会话管理
node scripts/run-cli.mjs new-chat --json
node scripts/run-cli.mjs temp-chat --json
node scripts/run-cli.mjs navigate-to --url "https://gemini.google.com/app/xxx" --json

# 切换模型
node scripts/run-cli.mjs switch-model --model pro --json

# 诊断
node scripts/run-cli.mjs check-login --json
node scripts/run-cli.mjs browser-info --json
node scripts/run-cli.mjs probe --json
node scripts/run-cli.mjs reload-page --json
```

## 关键规则

1. **所有操作走 CLI**。禁止自行启动浏览器、编写临时脚本调用内部 API、或使用截图代替图片提取
2. **生图耗时 60-180 秒**。`--timeout-ms` 至少设 180000，命令是同步阻塞的，等最终结果返回即可
3. **浏览器由 Daemon 管理**。首次运行自动拉起，30 分钟无活动自动关闭，无需手动操作
4. **首次使用需登录**。用 `check-login --json` 确认状态，未登录时提醒用户在弹出的浏览器中手动完成 Google 登录
5. **`--json` 是稳定契约**。脚本调用必须加 `--json`，stdout 只输出 JSON envelope

## 退出码

| 退出码 | 含义 |
|-------:|------|
| 0 | 成功 |
| 2 | 参数错误 |
| 3 | 未登录 |
| 4 | 浏览器启动失败 |
| 5 | 页面元素未找到 |
| 6 | 超时 |
| 7 | 被中断 |
| 8 | 内部错误 |

## 失败处理

- **生成超时（退出码 6）**→ 建议用户简化 prompt 后重试
- **未登录（退出码 3）**→ 提醒用户在浏览器中完成 Google 登录
- **元素未找到（退出码 5）**→ 尝试 `reload-page --json` 后重试
- **全尺寸下载失败** → 降级为不带 `--full-size` 的预览模式重试
