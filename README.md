# CueWave

See what matters. 听见声音，看见重点。

第一阶段是 Chrome YouTube 侧栏：视频留在 YouTube，CueWave 对完整时间戳字幕按 12 秒真实窗口调用 Jev，逐批显示多探针时间轴、独立排名热点、原句和播放器进度条上方的悬停柱形图。没有文本的窗口、未分析、低值、请求失败各自有不同显示。分析由用户确认探针后手动启动；播放、暂停、拖动和重播只读取缓存。

## 在本机运行

需要 Node.js 20+、Chrome 116+。在仓库根目录创建 `.env`（已被 Git 忽略）：

```dotenv
JEV_API_KEY=...
SUPADATA_API_KEY=...
# GEMINI_API_KEY=...  # 仅在手动启用 Gemini 时需要
```

Jev key 必须来自 [TypeSafe AI](https://docs.typesafe.ai/api)；其他名为 Jev 的代理服务使用不同 API 地址和凭证。Supadata key 可暂时省略，此时仍可导入字幕。

当前默认暂停 Gemini：新探针由本机生成可编辑草稿，不发送至 Gemini，也不做自动歧义检查。请手动校准名称、观察内容、判断标准、正反例和 Noul／Score 读数类型，再用 Jev 分析。已有探针及读数保留。将来要恢复 Gemini 检查，可配置 `GEMINI_API_KEY` 并用 `CUEWAVE_GEMINI_ENABLED=1 npm start` 启动；重启辅助进程并在 `chrome://extensions` 重新加载扩展后生效。

如果探针检查提示 `Gemini 项目预付额度已耗尽`，HTTP 402 指向密钥所属 Google AI Studio 项目的预付额度，不是探针描述格式错误。到 [Gemini API Billing 文档](https://ai.google.dev/gemini-api/docs/billing) 核对项目与 Credits；额度恢复后重启本机辅助进程，再重新检查新探针。重复点击不会消除 402。

```sh
npm start
```

Chrome 打开 `chrome://extensions`，开启开发者模式，点“加载已解压的扩展程序”，选择本仓库的 `extension` 文件夹。打开一条 YouTube 视频，在工具栏点击 CueWave 图标。先用预设词或自行输入探针，编辑并确认手动定义；自动获取原生字幕，或者导入与当前视频匹配的 SRT/VTT；最后点击“分析视频”。鼠标悬停 YouTube 进度条查看叠加柱形，点击柱形、侧栏轨道或热点可跳到片段并查看原句。柱形表示分析窗口，绝非逐秒测量。

自动字幕调用 [Supadata Transcript API](https://docs.supadata.ai/get-transcript) 的 `mode=native&text=false`，不会在缺字幕时自动启动收费的 AI 转写。长视频可能得到异步任务，辅助进程负责轮询。导入字幕仅在对应视频会话中使用，若字幕和视频不匹配，跳转会不准确。字幕、定义及读数保存在 Chrome 本地存储；供应商长期密钥只由监听 `127.0.0.1:4318` 的本机进程从 `.env` 读取。分析文本发送至 Jev；默认模式不会把探针描述发送至 Gemini；自动字幕请求将视频 ID 发送至 Supadata。

```sh
npm test
npm run smoke
npm run smoke -- --transcript
```

最后一条会对公开测试视频发起一次 Supadata 请求，可能消耗额度。Smoke test 使用内置的合成 SRT 检查导入管线，探测 Jev 的当前凭证；仅在手动启用 Gemini 时才会探测 Gemini。它不会把密钥、供应商响应正文或字幕写入日志。

复用来源：[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。参考仓库 youtube-digest 固定在 `bb2f7b1aedb6b50c261c0cf35b0acc7ed631d833`，保留其 MIT 声明。当前版本只实现 YouTube；现场麦克风、会议与独立大屏见 [`docs/BACKLOG.md`](./docs/BACKLOG.md)。
