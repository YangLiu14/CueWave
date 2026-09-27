# CueWave

See what matters. 听见声音，看见重点。

第一阶段是 Chrome YouTube 侧栏：视频留在 YouTube，CueWave 对完整时间戳字幕按 12 秒真实窗口调用 Jev，逐批显示多探针时间轴、独立排名热点、原句和播放器进度条上方的悬停柱形图。选中探针的柱形会突出于其他颜色之上。没有文本的窗口、未分析、低值、请求失败各自有不同显示。分析由用户确认探针后手动启动；播放、暂停、拖动和重播只读取缓存。

第二阶段的现场 Pitch 工作台已接入麦克风→Gemini Live 转写→Jev 读数的首条代码链。它仍需真实现场收音验收；不能仅凭接口连通就宣称演示效果达标。

每个已选探针旁都有“显示 / 不显示”开关。关闭后只隐藏该探针的侧栏时间轴、热点排名和播放器柱形图，不移除定义、读数，也不会中止该探针的分析。重新打开即可恢复显示；显示状态会随本机视频记录和导出的 JSON 保存。

每个 YouTube 标签页使用自己的 CueWave 侧栏实例。首次进入另一条视频所在的标签页时，点击一次扩展图标打开该标签页的侧栏；之后在已打开过的标签页间切换会显示各自的视频与分析进度。已手动开始、尚有未分析窗口的任务会逐窗口保存；若侧栏页面被关闭或重建，重新打开时会自动继续 pending 窗口，不重复请求已成功的读数，也不会自动重试失败窗口。点击“停止后续请求”会关闭自动续跑；手动再点“分析视频”可重试失败和未完成窗口。这不是独立于侧栏页面的永久后台任务：侧栏关闭期间执行可能暂停，且本机 `npm start` 进程仍需运行。

如果某个已打开的 YouTube 标签页在扩展更新后失去播放器消息接收端，侧栏会尝试重新挂载 CueWave 脚本与样式，不会重新调用 Jev。若仍无法显示柱形或跳转，当前视频标题下会显示具体连接错误；刷新该 YouTube 标签页并重开侧栏即可再次加载已保存读数。长视频上单个 12 秒窗口很窄，侧栏会给已完成窗口提供加宽、置顶的点击区域；热点排名按钮也可直接跳转。

## 在本机运行

需要 Node.js 20+、Chrome 116+。在仓库根目录创建 `.env`（已被 Git 忽略）：

```dotenv
JEV_API_KEY=...
SUPADATA_API_KEY=...
# 现场 Pitch 转写需要；不会自动开启旧的 Gemini 探针检查
GEMINI_API_KEY=...
```

Jev key 必须来自 [TypeSafe AI](https://docs.typesafe.ai/api)；其他名为 Jev 的代理服务使用不同 API 地址和凭证。Supadata key 可暂时省略，此时仍可导入字幕。

当前默认暂停 Gemini：新探针由本机生成可编辑草稿，不发送至 Gemini，也不做自动歧义检查。请手动校准名称、观察内容、判断标准、正反例和 Noul／Score 读数类型，再用 Jev 分析。已有探针及读数保留。将来要恢复 Gemini 检查，可配置 `GEMINI_API_KEY` 并用 `CUEWAVE_GEMINI_ENABLED=1 npm start` 启动；重启辅助进程并在 `chrome://extensions` 重新加载扩展后生效。

现场转写单独使用 `GEMINI_API_KEY`，不受 `CUEWAVE_GEMINI_ENABLED` 开关影响。长期 key 仍只在本机辅助进程；扩展通过本机 WebSocket 发送 16 kHz PCM 音频块。本机代理再连接 [Gemini Live Transcribe](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe) 的 `gemini-3.5-transcribe-live`。这与 YouTube 的 Gemini 探针歧义检查是两项独立功能。

如果探针检查提示 `Gemini 项目预付额度已耗尽`，HTTP 402 指向密钥所属 Google AI Studio 项目的预付额度，不是探针描述格式错误。到 [Gemini API Billing 文档](https://ai.google.dev/gemini-api/docs/billing) 核对项目与 Credits；额度恢复后重启本机辅助进程，再重新检查新探针。重复点击不会消除 402。

```sh
npm start
```

Chrome 打开 `chrome://extensions`，开启开发者模式，点“加载已解压的扩展程序”，选择本仓库的 `extension` 文件夹。打开一条 YouTube 视频，在工具栏点击 CueWave 图标。先用预设词或自行输入探针，编辑并确认手动定义；自动获取原生字幕，或者导入与当前视频匹配的 SRT/VTT；最后点击“分析视频”。鼠标悬停 YouTube 进度条查看叠加柱形，点击柱形、侧栏轨道或热点可跳到片段并查看原句。柱形表示分析窗口，绝非逐秒测量。侧栏的同步字幕开关默认关闭；开启后按所用字幕的时间戳在视频底部显示，若与 YouTube 自带字幕重叠，可关闭其中一处。

现场模式：运行新版 `npm start` 并在 `chrome://extensions` 重新加载扩展。在任一 YouTube 视频侧栏点“打开现场工作台”，它会另开一个 `CueWave · 现场 Pitch` 标签页；YouTube 分析本身绝不启动麦克风。现场页点“开始收音与分析”后才请求麦克风权限，优先选择识别到的 MacBook 内置麦克风，否则使用浏览器默认设备。现场页必须保持打开，但可以切换到其他视频标签页。临时字幕只预览，最终字幕才送给 Jev 的“无聊程度”和“空洞概念”两个默认 Score 探针。热点和轨道可点开核对原句；现场没有录音回放。跨项目可点“新项目”，也会在长停顿且出现明显开场语时自动推测新段。点停止会释放麦克风；随后下载 JSON 或直接删除本次场次。默认不保存原始录音，也不自动持久化字幕和读数。

Gemini Live 的单连接时长上限为 10 分钟，本机代理会在约 9 分钟时续接；连接期间的音频缺口会明确显示，不能当成低分。实时转写不提供词级时间戳，所以现场轨道使用本机采集时间近似定位。当前尚未实测中文／英文真人发言、持续多项目完整场次、自动边界质量和端到端延迟；项目段的合并、拆分与边界拖动也未实现。ASR 供应商精度／时延／费用比较仍在 backlog。

分析结果会在本机按视频 ID 保存字幕、当时的探针定义、读数与进度。侧栏“已保存视频”可重开记录、打开原视频或删除本机记录；“导入 CueWave JSON”兼容先前导出的 v1 文件和当前 v2 文件。导入其他视频的 JSON 不会覆盖当前视频；再次进入原视频时自动恢复。保存结果按钮仍会下载独立 JSON，建议在演示前备份。卸载扩展或清除扩展数据会丢失本机历史，但不会影响已下载的 JSON。

“推广信息”探针在高分窗口出现后，可手动点击“细化广告边界”：CueWave 会逐条复判热点内的字幕，并将达到阈值的相邻字幕合并成近似广告区间，标在进度条和侧栏。它会额外调用 Jev，且边界精度仅等于字幕时间戳，不代表词级或音频级广告起止点。

长视频开始分析前，侧栏会显示待分析 Jev 请求数、判断项数和粗估输入 token / 费用；分析中显示成功响应累计的供应商 token 用量与参考费用，以及本机缓存占用。Jev 1.13 的参考输入价格来自 [TypeSafe AI 模型页](https://docs.typesafe.ai/models)（2026-09-27 核对）；估算不含失败重试、Supadata 成本或今后价格变化，也不是最终账单。Chrome `storage.local` [默认配额为 10 MiB](https://developer.chrome.com/docs/extensions/reference/api/storage)。容量较高时先下载 JSON 再删除不需要的本机记录；若缓存写入失败，分析仍可继续，但必须下载 JSON 才能保留当前结果。

自动字幕调用 [Supadata Transcript API](https://docs.supadata.ai/get-transcript) 的 `mode=native&text=false`，不会在缺字幕时自动启动收费的 AI 转写。长视频可能得到异步任务，辅助进程负责轮询。导入字幕仅在对应视频会话中使用，若字幕和视频不匹配，跳转会不准确。字幕、定义及读数保存在 Chrome 本地存储；供应商长期密钥只由监听 `127.0.0.1:4318` 的本机进程从 `.env` 读取。分析文本发送至 Jev；默认模式不会把探针描述发送至 Gemini；自动字幕请求将视频 ID 发送至 Supadata。

```sh
npm test
npm run smoke
npm run smoke -- --transcript
```

最后一条会对公开测试视频发起一次 Supadata 请求，可能消耗额度。Smoke test 使用内置的合成 SRT 检查导入管线，探测 Jev 的当前凭证；仅在手动启用 Gemini 时才会探测 Gemini。它不会把密钥、供应商响应正文或字幕写入日志。

复用来源：[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。参考仓库 youtube-digest 固定在 `bb2f7b1aedb6b50c261c0cf35b0acc7ed631d833`，保留其 MIT 声明。会议、独立大屏和现场转写的剩余验收见 [`docs/BACKLOG.md`](./docs/BACKLOG.md)。
