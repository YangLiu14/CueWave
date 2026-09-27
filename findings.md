# 发现与决策

## 2026-09-27 现场结果页
- 当前 `live.js` 的 `state.session` 只在页面内存中；停止后可手动下载 JSON，但关闭标签页就无法从界面重开，用户所要的“保留转写”尚未实现。
- “新项目”只新增边界并继续收音；实时字幕、两探针当前值与轨道仍混在同一现场页，没有按项目查看的结果页。
- `nextLiveWindow()` 已按 `projectId` 分析，读数和最终字幕也带 `projectId`，可直接用于每项目结果；临时字幕不能持久化为正式证据。
- 结果页应保留分析中的 pending 状态，不把缺失或失败读数当零分。两探针分别显示时序分布、统计和原句核对。
- Chrome 扩展已具备 `storage` 权限；本轮复用 `chrome.storage.local` 保存每场次快照，JSON 仍作为独立导出。新项目自动展示刚结束项目的结果，停止后展示全场结果；原现场页继续采集或完成剩余 Jev 判断。
- 结果页对同场次的 `chrome.storage.onChanged` 增量更新；探针平均值和峰值只取有效读数，失败与尚未分析分开呈现。开始下一场无需删除已结束的旧记录。
- 浏览器自动化不允许访问 `chrome-extension://` 协议，故本轮只能用隔离 DOM 测试验证页面结构和数据渲染，不能声称真实 Chrome 视觉验收通过。

## 2026-09-27 Phase 2：现场 pitch
- 用户确认最关注的两项：讲话是否使听众失去注意力；是否大量使用缺少事实或落地细节的空洞概念。消息末尾的第 3 项尚未给出，暂不添加第三探针。
- `docs/adr/0001-hackathon-demo-scope.md`：MacBook 内置麦克风持续采集多个 pitch；会议采集不交付；现场用原有 Gemini 凭证先做 ASR smoke test，更广泛供应商比较在 backlog。
- `docs/adr/0003-continuous-capture-and-project-boundaries.md`：总时间轴不中断，静音＋内容推测边界，可手动切换；问答归当前项目、串场归间场。
- `docs/adr/0004-provisional-live-readings.md`：临时字幕／预览读数不得混入正式曲线；最终字幕才产生正式结果。
- 当前 `server/index.js` 仅有 YouTube 字幕、探针检查、Jev 判断接口；Gemini 探针检查默认关闭。现场 ASR 是独立用途，不应暗中重新开启旧探针检查。
- Google 官方 2026-08 Live Transcribe 文档指定 `gemini-3.5-transcribe-live`、16kHz mono PCM、100ms 音频块；区分 interim 与 final，自动语言检测可处理中英混合。单连接最长 10 分钟，需要续接；无词级时间戳，现场时间轴需标注为本地采集时间近似。来源：https://ai.google.dev/gemini-api/docs/live-api/live-transcribe
- Google 官方建议浏览器直连 Live API 时由本地服务签发受约束的短期 token，不把长期 API key 放进扩展；REST `/v1beta/auth_tokens` 支持 `liveConnectConstraints`。来源：https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
- `.env` 存在 `GEMINI_API_KEY` 与 `JEV_API_KEY`；旧探针检查仍由 `CUEWAVE_GEMINI_ENABLED` 控制。不能仅凭密钥存在宣称 Gemini ASR 可用。
- 凭证 smoke：向 `/v1beta/auth_tokens` 申请 20 分钟的一次性短期 token 成功（HTTP 200），但带官方文档示例中的 `liveConnectConstraints` 申请返回 HTTP 400：`Unknown name "liveConnectConstraints" at 'auth_token'`。因此当前项目实测不能依赖该约束字段；后续若采用短期 token，需明确这是该接口限制下的单机演示折中，仍不得暴露长期密钥。
- 原生 Node WebSocket 用长期密钥从本机进程发起，`gemini-3.5-transcribe-live` 返回 `setupComplete`。短期 token 放在 `access_token` query 时连接以 1008 拒绝（未建立调用者身份）；暂不采用浏览器直连，改用本机 WebSocket 代理持有长期密钥。
- `无聊程度` 现已有可用 Score 定义；`buzzword含量` 只衡量难懂术语，不能等同于用户新强调的“缺少事实或落地细节的空洞概念”，需新增独立探针。
- 本机实际集成 smoke：`/live/config` 返回 ASR/Jev 可用和两项默认探针；本机 WebSocket 代理持长期密钥连接 Gemini `gemini-3.5-transcribe-live` 并收到 `ready`；两项探针对合成中文空泛 pitch 的真实 Jev 请求返回有效 Score。尚未采集真人麦克风音频，因此不能宣称现场 ASR 准确率或端到端延迟达标。
- 独立工作台在隔离的本地静态浏览器预览中布局正常（桌面宽度）：两栏、收音控制、字幕、时间轴与证据区均可见。该预览源不是 `chrome-extension://`，按本机服务的来源保护无法调用 live/config；这不是实际扩展运行验收。没有触发麦克风权限或收音。
- 真实 Gemini ASR 合成语音 smoke（非真人麦克风）：用 macOS 系统语音生成约 9 秒中文和约 7 秒英文，两段分别编码为 16 kHz mono PCM、通过新增本机 WebSocket 代理按 100ms 发送，Gemini 均返回了与合成语音基本一致的最终字幕。临时音频测试文件已清理。这证实当前音频协议和中英自动语言路径可用，但不说明会场噪声、专有名词或真人口音准确率。

## 需求
- 实现上一轮建议中的第 2–5 项；第 1 项真实视频检查暂缓。
- 已保存分析须能导入并重开原时间轴，包含当时探针定义与读数。
- 广告热点需要更准确的位置但不能伪称逐帧精度。
- 播放器叠层应清楚突出所选探针，并可同步显示字幕。
- 长视频应提前展示调用规模、成本和本地容量风险。

## 研究发现
- 当前导出格式 `cuewave-video-analysis` v1 已包含视频 ID、字幕毫秒时间戳、探针定义和逐 12 秒窗口读数，但没有导入器或历史列表。
- 浏览器缓存以 `cuewave:video:<id>` 保存字幕和读数；探针定义保存在一个全局 `cuewave:definitions`，重开后若定义被修改，旧读数无法作为原轨道展示。
- `buildWindows` 固定 12 秒，任何与窗口相交的字幕整段进入该窗口；原始字幕时间戳可支持对高分广告簇做字幕级近似边界，不能声称词级精度。
- 播放器叠层把每个探针的柱形绝对定位在同一基线，后插入的柱形可能盖过所选探针；当前没有同步字幕覆盖层。
- 分析循环逐窗口顺序调用 Jev；一个请求可批量包含至多 5 个探针。现无估算请求量、费用、时长或本地缓存占用展示。
- 现有单元测试只覆盖字幕解析、窗口、读数、热点和导出，尚无导入/历史/边界/叠层或费用估算测试。
- TypeSafe 官方模型页（2026-09-27 查阅）标示 Jev 1.13 输入价 $0.042 / 百万 token，输出免费；官方 quickstart 的响应示例含 `usage.input_tokens`。所以预计费用需明确标“粗估”，实际费用应从返回 usage 累计，不按请求数直接乘一个固定价。
- Chrome 官方文档标示 `storage.local` 默认配额 10 MiB，`getBytesInUse` 可读取实际占用；扩展移除时本地数据会清除。无需申请 unlimitedStorage 就可先展示容量和清理入口。

## 技术决策
| 决策 | 理由 |
|------|------|
| 导入支持现有 v1 JSON，并在新导出中可选带字幕级广告边界和实际用量 | 兼容用户已经保存的文件，不破坏历史 |
| 历史列表从各视频独立记录生成，每个视频保留探针快照和读数 | 多标签页并行写入时避免共享历史索引的读改写竞争；本机 MVP 可接受读取全部本地记录 |
| 同步字幕默认关闭，用户可在侧栏开启 | 避免与 YouTube 自带字幕重叠；不重复发送完整字幕到每次进度图更新 |
| 广告字幕级复判由用户显式启动且可缓存结果 | 避免静默增加 Jev 请求和费用 |

## 遇到的问题
| 问题 | 解决方案 |
|------|---------|

## 资源
- 本仓库的 `extension/`、`server/`、`tests/`。
- 官方 Jev 模型与价格：https://docs.typesafe.ai/models
- 官方 Jev usage 示例：https://docs.typesafe.ai/introduction/quickstart
- Chrome storage 文档：https://developer.chrome.com/docs/extensions/reference/api/storage

## 视觉/浏览器发现
- 已静态核对播放器叠层的选中层级、广告区间和同步字幕消息链；未在真实 YouTube 页面做人工视觉验收，按用户要求把第 1 项留待其后续检查。

## 2026-09-27 多标签页续跑任务
- 用户确认按标签页独立应用实例，并在侧栏重新打开时自动续跑未完成分析的 MVP 路线。
- 旧任务的未提交改动仍在工作区；本轮必须保留，不做重置。
- 当前 manifest 同时声明全局 `side_panel.default_path`，后台又只在点击图标时为当前 tab 执行 `sidePanel.setOptions`；这会混用全局和标签页专属实例。
- 分析循环在 `extension/sidepanel.js` 页面实例中，已有逐窗口保存与有效读数跳过逻辑，但没有重新打开后自动续跑。
- Chrome 官方 Side Panel 文档确认：同一路径的全局面板与 tab-specific 面板是不同实例；站点专属面板在不适用的标签页会隐藏，切回此前打开过的标签页可再显示。`sidePanel.open` 需要用户操作，因此不能在普通 tab 切换事件里强行首次打开 B 面板。
- 本轮测试 seam 应覆盖两个环节：后台给 A/B 各设 tab-specific path，侧栏实例从 path 中读取绑定的 tabId，而不是读取当前活跃 tab。
- 断点续跑只恢复用户已主动启动且未手动停止的任务；自动续跑跳过成功和失败读数，仅继续 pending 窗口，避免关闭后无限重试失败请求。
- `node --test tests/multitab.test.js` 已稳定复现两处红灯：manifest 的全局 `default_path` 仍存在；指定 `?tabId=1` 的侧栏在 B 活跃时错误显示“视频 B”。
- 官方示例及其 issue 提示：`sidePanel.open` 的用户手势不能可靠地跨越等待 `setOptions` 的异步边界。因此优先在 `tabs.onUpdated/onActivated` 预配置 tab-specific path，并让浏览器的 `openPanelOnActionClick` 处理点击打开。
- 经官方文档核对，移除 global `default_path` 后，tab-specific panel 应由 `setOptions({tabId, path, enabled:true})` 提供；仍需真实 Chrome 验证扩展图标首次打开与切换表现。尝试打开一个猜测的示例仓库路径得到 404，不把该路径当证据。
- 随后找到 Google 官方 `cookbook.sidepanel-site-specific` 示例：manifest 确实没有 `side_panel.default_path`，后台同时使用 `openPanelOnActionClick` 与 `tabs.onUpdated` 的 `setOptions`，支持本轮选择的结构。
- 自动续跑回归测试先红后绿：保存一条已成功的窗口和一条 pending，重开侧栏只应请求 pending，完成后清除续跑标记。
- 多标签页并行的关键额外 bug：`chrome.runtime.onMessage` 会广播给各侧栏实例；原监听没有检查 `sender.tab.id`，B 的 `cuewave:navigated` 可误置 A 的 `state.cancelled`。先将 B 导航事件插入 A 的待完成 Jev 请求中，测试红灯（A 读数仅 1 条），按 sender.tab.id 过滤后转绿。
- 最终自动测试 22/22 通过，涵盖标签页专属 path、非 YouTube 禁用、固定 tabId 绑定、仅 pending 续跑、跨标签页导航隔离及手动停止。真实 Chrome 中首次开图标和视觉效果尚未人工验收。

## 长视频部分分析后展示/跳转故障
- 用户的 3:31:23 YouTube 页面进度条存在，但 CueWave histogram 节点和柱形均不存在；另一条已分析的视频页面有 183 根柱形。播放器是否收到图还不能仅凭 DOM 判断。
- 现有侧栏 `pushGraph` 和 `jump` 均吞掉 `tabs.sendMessage` 错误；在消息接收者缺失时，读数可以保存在侧栏，却无视频叠层或跳转反馈。
- 12 秒窗口占 12683 秒视频约 0.0946%；在 320px 侧栏轨道上仅约 0.30px。即使消息正常，逐窗口直接点击也是不可用的命中目标。
- 现有 `.cell` 统一 `min-width:2px`，而长视频相邻窗口中心仅隔约 0.30px；后插入的未分析/无文本 cell 会遮住先前成功 cell，造成已分析段既不可见也点不到。需要让成功读数的可点击标记保持在上层。
- 新增真实侧栏调用链回归测试：保存热点可显示，但 `tabs.sendMessage` 在接收脚本缺席时拒绝；测试先红，断言自动恢复接收端后图与跳转都能送达。
- Chrome 官方 `scripting` API 需要 `scripting` 权限和目标站点 host permission；当前已有 YouTube host permission，可在消息接收端缺失时按需注入扩展自带的 `content.js` 和 CSS（来源：https://developer.chrome.com/docs/extensions/reference/api/scripting）。
- 对真实 `content.js` 的隔离测试表明：收到图时播放器进度 DOM 尚未就绪，MutationObserver 能在 DOM 出现后挂载柱形，seek 回执也会设置 `video.currentTime`；因此“播放器节点晚到”不是当前主要问题。
- 已在侧栏恢复接收端后校验消息回执；错误按 info/graph/seek/captions 分开保留，避免字幕成功错误地抹掉热力图失败提示。

## 2026-09-27 Chrome 扩展错误
- 用户截图中的“错误”按钮展开后，Chrome 记录三条 `Uncaught Error: Extension context invalidated.`，上下文是旧 YouTube 标签页，堆栈均指向 `content.js:9`；不是 Service Worker 启动错误。
- `send()` 只给 `chrome.runtime.sendMessage()` 的返回 Promise 加 `.catch()`；扩展重载使旧内容脚本上下文失效时，调用本身同步抛错，因此 `.catch()` 无法拦截。
- 新回归测试用同步抛错的 `sendMessage` 复现启动与后续 YouTube SPA 导航路径；修复后仅吞掉明确的上下文失效异常，并停止继续调用已失效的 runtime。
- 已经注入到旧标签页的旧版内容脚本无法被磁盘代码更新；扩展重新加载后仍须刷新这些标签页。Chrome 错误页的历史条目也不会因代码修改自动消失。

## 2026-09-27 项目介绍单页
- 当前 README 说明 YouTube 侧栏可对带时间戳的字幕逐窗分析并跳转；实时判断已有麦克风→Gemini 转写→Jev 管线，但仍需真人场景验收；线上会议在 ADR 0001 中明确不属于已交付 MVP。
- 长视频按窗口顺序请求，用户提出的“5～30 秒扫描”尚无全片基准数据；介绍页不应写成稳定完成时限。
- Jev 官方 API 支持在同一文本 state 中提交多个 Score/Noul 问题并取得结构化读数；它目前只接收文本，语音必须先转写。详见 `docs/research/jev-vs-llm.md`。
- 通用 LLM 也能提供结构化输出，故 Why Jev 应解释“逐段判断与读数的任务匹配”，不虚构跨模型性能对比。
