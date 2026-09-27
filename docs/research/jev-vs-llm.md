# Why Jev? Why not a general-purpose LLM? — 文案依据

核对日期：2026-09-27。以下只依据 TypeSafe AI 与 OpenAI 的一手文档；文案应描述 CueWave 选择 Jev 的任务匹配度，不宣称通用 LLM 做不到同类工作。

## 可用于一页介绍的要点

1. **把关注点变成可读数的判断。** Jev 接收文本或结构化 `state`，对用户定义的问题直接返回结构化 `answers`。CueWave 可以据此把字幕片段映射到语义轨道，而不必把生成的一段解释文字当作读数解析。[TypeSafe 介绍](https://docs.typesafe.ai/introduction) · [API reference](https://docs.typesafe.ai/api)
2. **两种读数表达不同问题。** `Score` 根据自定义的有序等级给出概率加权的分值，适合“具体程度”等程度问题；`Noul` 给出某个是／否判断的 yes 概率，适合“是否明确提出行动项”等问题。`Noul=0.5` 表示模型在 yes/no 之间不确定，并非“中等强度”；Score 也不是天然的百分比或客观标尺。[Primitives](https://docs.typesafe.ai/primitives) · [API reference](https://docs.typesafe.ai/api)
3. **同一段文本可以问多个独立问题。** API 的 `questions` map 可在一次调用中混用 Score、Noul（也支持 Choice），每个答案按自定义 ID 返回；TypeSafe 说明同一 `state` 上的问题会并行、独立评估。这适合把一段字幕上的多个探针读数放在一起请求。这里的“批量”指对**同一段 state 的多个问题**，不表示多个时间窗口可自动合并成一个无边界的请求。[TypeSafe 介绍](https://docs.typesafe.ai/introduction) · [Primitives](https://docs.typesafe.ai/primitives) · [API reference](https://docs.typesafe.ai/api)
4. **选择专门的判断接口，是产品取舍，不是通用模型能力缺失。** Jev 的接口内建上述问题类型及数值／分布输出，适合 CueWave 的时间轴读数；通用 LLM 也能用结构化输出匹配指定 JSON schema，且更适合生成摘要、解释等内容。因此可写“我们选 Jev 做逐段语义判断”，不要写“LLM 无法输出结构化结果”。[TypeSafe 介绍](https://docs.typesafe.ai/introduction) · [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## 性能与费用措辞

TypeSafe 当前模型页列出 Jev 1.13 的按输入 token 定价（$0.042 / 1M input tokens，输出 token 免费），以及 64k 总上下文、`state` 加最长问题 32k 的限制。其官方 cookbook 在一篇约 54,000 字符文档、13 个问题的**特定**实验里，报告一调用相较 13 次顺序调用便宜 12.2 倍、快 10.0 倍；文档明确说明并发发起单问题调用会缩小时间差。该实验用 Jev 1.12，比较的是 Jev 批量与 Jev 单问调用，**不是 Jev 与通用 LLM 的横向基准**。一页介绍可保留“对同一文本合并多个问题，减少重复发送文本和请求”这一机制性说法；没有 CueWave 自己的对照测量时，避免速度、费用倍数或“比 LLM 更快／便宜”。[Models](https://docs.typesafe.ai/models) · [Parallel questions cookbook](https://docs.typesafe.ai/cookbooks/parallel_questions)

补充：TypeSafe 在[发布博客](https://typesafe.ai/blog/introducing-system-one-models-and-jev)中另有 Jev 对所测通用 LLM 的结构化工作流对照，并明确说明任务选择、答案基准与测试方式等限制。若页面需要提及跨模型优势，应写成“TypeSafe 公布的特定任务对照中，比所测通用 LLM 更快、更便宜”，同时标明这是供应商结果，不能推论 CueWave 的端到端速度、所有 LLM 或所有任务。上段应避免的是**无归因的普遍性能断言**，不是禁止准确归因供应商测试。

## 必须守住的边界

- Jev 当前只收文本／文本结构化数据，不直接分析音频或视频；现场语音须先转写。英文是目前效果最好的训练语言，中文等 CJK 需用实际内容测试。[Models](https://docs.typesafe.ai/models)
- TypeSafe 建议每个问题聚焦一个明确判断；复杂推理应拆分后在代码中组合。Jev 1.13 官方已知问题包括字面理解、数字精度、无关长文本与对抗性内容；Score 等级数值不宜用于推断精确物理量。[Primitives](https://docs.typesafe.ai/primitives) · [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
- `Score`/`Choice` 的 `confidence` 是从模型给出的概率分布计算的集中程度，`Noul` 没有单独的 `confidence` 字段；不要称其为实测正确率。概率读数也不能证明字幕中的主张为真。[Confidence](https://docs.typesafe.ai/confidence) · [Primitives](https://docs.typesafe.ai/primitives)
- 避免“零误判”“已验证事实”“准确识别所有中文讽刺”“实时必达”“绝对低成本”等结论。模型别名会随版本更新，限流可能动态调整，外部转写与网络延迟也在 CueWave 端到端路径中。[Models](https://docs.typesafe.ai/models) · [API reference](https://docs.typesafe.ai/api)
