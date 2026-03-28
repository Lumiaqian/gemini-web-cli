# Gemini Flow

## 1) 登录校验

最小校验项：
- 页面存在可输入提问的输入框
- 右上角有用户头像或账户入口

若未登录：提示用户先在 Daemon 托管的浏览器中手动登录 Google 账号（Daemon 未运行时会自动后台拉起）。

## 2) 模型策略

优先级：
1. Gemini 3.1 Pro
2. 当前页面可见的次优 Pro/Advanced 模型

若切换失败，保留默认并告知用户。

## 3) 按钮状态检测

`.send-button-container` 内的按钮通过 `aria-label` 区分三种状态：

- **空闲（idle）**：aria-label 为麦克风相关，按钮 disabled，输入框为空。
- **可发送（ready）**：aria-label 为"发送"/"Send"，输入框有内容。
- **生成中（loading）**：aria-label 为"停止"/"Stop"，Gemini 正在输出。

使用方式：
- `GeminiOps.getStatus()` → 返回 `{status: 'idle'|'ready'|'loading', label, disabled}`
- `GeminiOps.pollStatus()` → 返回 `{status, label, pageVisible, ts}`，**毫秒级返回**，供调用端分段轮询

### CDP 保活轮询（重要）

**禁止**在页面内做长 Promise 等待（旧版 `waitForComplete` 已移除）。

正确做法：调用端每 8~10 秒 evaluate 一次 `GeminiOps.pollStatus()`，自行累计耗时并判断超时。
这确保 CDP WebSocket 通道持续有消息流量，避免被网关判定空闲而断开连接。

## 4) 生图结果获取

> ⚠️ **严禁使用浏览器截图（screenshot）获取生成图片。**
> - **默认流程**：通过 `src` URL 右键另存为（Save Image As）保存到本地，再发送给用户。
> - **高清流程**：仅当用户明确要求高清/原图时，才调用 `downloadLatestImage()` 点击原图下载按钮。

Gemini 一次只生成一张图片，流程上只关心**最新生成的那张**，历史图片不做处理。

调用 `GeminiOps.getLatestImage()` 获取最新一张生成图片。

### DOM 结构

```
<div class="image-container ...">
  <button class="image-button ...">
    <img class="image loaded" src="https://lh3.googleusercontent.com/..." alt="AI 生成">
  </button>
  <div class="button-icon-wrapper">
    <mat-icon fonticon="download" data-mat-icon-name="download" class="button-icon ..."></mat-icon>
  </div>
</div>
```

### 图片定位

- 选择器：`img.image.loaded`
- `image` class = Gemini 的图片元素
- `loaded` class = 图片已渲染完成（未加载完的不会有此 class）
- 两个 class 同时存在才算有效图片
- DOM 中可能存在多张历史图片，**取最后一个**即为最新生成

### 下载按钮定位

- 从 `img` 向上找到最近的 `.image-container` 祖先容器
- 在容器内查找 `mat-icon[fonticon="download"]`（即下载原图按钮）
- `getLatestImage()` 返回 `hasDownloadBtn` 字段标识是否有下载按钮

### API

所有操作函数的返回值都包含 `debug` 字段，记录该次调用每一步的日志（含时间戳、步骤名、成功/失败、上下文详情），方便排查问题和改进策略。

- `GeminiOps.getLatestImage()` → 获取最新一张图片信息

```json
{
  "ok": true,
  "src": "https://lh3.googleusercontent.com/...",
  "alt": "AI 生成",
  "width": 1024,
  "height": 1024,
  "hasDownloadBtn": true,
  "debug": [
    {"ts": 1710000000000, "fn": "getLatestImage", "step": "start", "ok": true},
    {"ts": 1710000000001, "fn": "getLatestImage", "step": "query_imgs", "ok": true, "detail": {"totalFound": 1}},
    {"ts": 1710000000002, "fn": "getLatestImage", "step": "picked_latest", "ok": true, "detail": {"index": 0, "src": "https://lh3.google..."}},
    {"ts": 1710000000003, "fn": "getLatestImage", "step": "find_container", "ok": true},
    {"ts": 1710000000004, "fn": "getLatestImage", "step": "find_download_btn", "ok": true}
  ]
}
```

- `GeminiOps.downloadLatestImage()` → 点击最新图片的下载原图按钮（仅用户要求高清时）

```json
{"ok": true, "src": "https://lh3.googleusercontent.com/...", "debug": [...]}
```

- `GeminiOps.extractImageBase64()` → **默认图片获取方式**，从 DOM 直接提取 Base64

```json
{
  "ok": true,
  "dataUrl": "data:image/png;base64,iVBORw0KGgo...",
  "width": 1024,
  "height": 1024,
  "method": "canvas",
  "debug": [...]
}
```

  提取策略（自动选择，无需调用端干预）：
  1. **Canvas 提取**（优先）：将已渲染的 `<img>` 绘制到虚拟 Canvas，同步导出 `toDataURL('image/png')`。零网络请求，毫秒级完成。`method` 返回 `"canvas"`。
  2. **Fetch fallback**：若 Canvas 因跨域 tainted 而报错，自动回退到页面内 `fetch(img.src)` → `blob` → `FileReader.readAsDataURL()`。`method` 返回 `"fetch"`。

  > ⚠️ 该函数返回 **Promise**。CDP 调用时必须设置 `awaitPromise: true`：
  > ```js
  > // CDP Runtime.evaluate 示例
  > { expression: "GeminiOps.extractImageBase64()", awaitPromise: true, returnByValue: true }
  > ```

  调用端拿到 `dataUrl` 后，去掉 `data:image/png;base64,` 前缀，解码为二进制存为 `.png` 文件即可。

- `GeminiOps.probe()` / `click()` / `fillPrompt()` / `pollStatus()` → 同样携带 `debug` 字段

- `GeminiOps.getDebugLog()` → 获取完整累积日志（不清空），用于事后排查

```json
{"log": [...], "count": 15}
```

### debug 日志格式

每条日志条目：

| 字段 | 类型 | 说明 |
|---|---|---|
| `ts` | number | 毫秒级时间戳 |
| `fn` | string | 函数名，如 `click`、`getLatestImage` |
| `step` | string | 步骤名，如 `start`、`find_container`、`clicked` |
| `ok` | boolean | 该步骤是否成功 |
| `detail` | object? | 可选，上下文信息（匹配的选择器、找到的元素数量等） |

调用端应将 `debug` 数组回传给用户，便于分析定位失败原因和优化选择器策略。
```

### 图片交付流程（重要）

**默认流程（Base64 提取）：**
1. 调用 `GeminiOps.getLatestImage()` 确认图片已渲染完成（`ok: true`）
2. 调用 `GeminiOps.extractImageBase64()` 提取图片数据（需 `awaitPromise: true`）
3. 去掉 `dataUrl` 的 `data:image/png;base64,` 前缀，解码为二进制，保存为 `.png` 文件
4. 将本地图片文件发送给用户

**高清流程（仅用户要求时）：**
1. 调用 `GeminiOps.getLatestImage()` 确认图片已渲染完成
2. 调用 `GeminiOps.downloadLatestImage()` 点击原图下载按钮
3. 将下载到本地的高清原图文件发送给用户

> **严禁**在任何环节使用浏览器截图（screenshot）代替保存图片。

### 回退

- `ok === false` → 页面可能还在渲染，等几秒再调一次
- 连续两次失败 → 做 snapshot 排查页面状态（snapshot 仅用于排查，不用于交付图片）

## 5) 用户提示文案（建议）

- 开始生图：
  - `已收到，正在用 Gemini 给你绘图中 🎨`
- 生成中超时：
  - `还在渲染中，我继续盯着，马上回你。`
- 完成：
  - `画好了，给你发图啦～`
