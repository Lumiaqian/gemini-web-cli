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

### CDP 保活轮询

调用端每 8~10 秒 evaluate 一次 `pollStatus()`，自行累计耗时并判断超时。
确保 CDP WebSocket 通道持续有消息流量，避免被网关判定空闲而断开连接。

## 4) 生图结果获取

### 图片定位

- 选择器：`img.image.loaded`
- `image` class = Gemini 的图片元素
- `loaded` class = 图片已渲染完成
- DOM 中可能存在多张历史图片，取最后一个即为最新生成

### 图片交付流程

**默认流程（预览提取）：**
1. `getLatestImage()` → 确认图片已渲染完成，获取 src URL
2. `extractImageBase64(src)` → 通过 Canvas（blob URL）或 CDP Network（非 blob URL）提取图片数据，自动去水印
3. 解码 dataUrl 为二进制，保存为 `.png` 文件

**全尺寸下载流程：**
1. `downloadFullSizeImage({ index })` → 通过 CDP 直接获取图片二进制数据并保存到 outputDir，自动去水印
   - blob: URL → 内部委托 `extractImageBase64`（Canvas 提取），再解码保存为文件
   - 非 blob URL → CDP `Network.loadNetworkResource` 直接获取二进制流，保存为文件
2. 返回 `{ ok, filePath, suggestedFilename, src, index, total }`

> 注意：此流程不依赖任何 UI 下载按钮，纯 CDP 网络层操作，兼容 Gemini 页面 DOM 变更。

### 回退

- `ok === false` → 页面可能还在渲染，等几秒再调一次
- 全尺寸下载失败 → 降级为 `extractImageBase64` 预览模式
- 连续两次失败 → 排查页面状态

## 5) 用户提示文案（建议）

- 开始生图：`已收到，正在用 Gemini 给你绘图中 🎨`
- 生成中超时：`还在渲染中，我继续盯着，马上回你。`
- 完成：`画好了，给你发图啦～`
