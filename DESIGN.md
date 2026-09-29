---
name: CueWave
description: 可核对的 YouTube 语义时间轴侧栏，以时间登机牌与语义换乘图呈现同一组证据。
colors:
  gate-background: "#cfd2ce"
  gate-paper: "#f5f3e9"
  gate-paper-secondary: "#eeece1"
  gate-ink: "#17232e"
  gate-muted: "#5f696c"
  gate-faint: "#7d878b"
  gate-rule: "#c3c4bd"
  gate-rule-strong: "#7b858a"
  gate-accent: "#178d78"
  gate-accent-soft: "#dcebe5"
  gate-danger: "#b74e43"
  gate-danger-soft: "#f3ded9"
  gate-focus: "#ff603f"
  transit-background: "#090f12"
  transit-paper: "#11191e"
  transit-paper-secondary: "#141e23"
  transit-ink: "#eef5f2"
  transit-muted: "#8e9da4"
  transit-faint: "#75868e"
  transit-rule: "#334149"
  transit-rule-strong: "#44535b"
  transit-accent: "#5bd3bd"
  transit-accent-soft: "#173832"
  transit-danger: "#ff7b70"
  transit-danger-soft: "#3a2020"
  transit-focus: "#ffd45f"
  action-hover-ink: "#07130f"
  probe-teal: "#178d78"
  probe-coral: "#ec6445"
  probe-violet: "#8470cf"
  probe-pink: "#e879a2"
  probe-blue: "#8eb7f3"
typography:
  display:
    fontFamily: '"Avenir Next", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "clamp(18px, 5.3vw, 24px)"
    fontWeight: 700
    lineHeight: 1.22
    letterSpacing: "-0.035em"
  headline:
    fontFamily: '"Avenir Next", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: '"Avenir Next", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: '"Avenir Next", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "11px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "normal"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "normal"
    fontFeature: "tabular-nums"
rounded:
  stamp: "2px"
  gate: "3px"
  transit: "11px"
  pill: "99px"
spacing:
  xs: "3px"
  sm: "7px"
  md: "10px"
  lg: "15px"
  xl: "18px"
  wide: "29px"
components:
  button-primary-gate:
    backgroundColor: "{colors.gate-ink}"
    textColor: "{colors.gate-paper}"
    typography: "{typography.label}"
    rounded: "{rounded.gate}"
    padding: "7px 10px"
    height: "44px"
  button-primary-transit:
    backgroundColor: "{colors.transit-background}"
    textColor: "{colors.transit-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.transit}"
    padding: "7px 10px"
    height: "44px"
  probe-input:
    backgroundColor: "transparent"
    textColor: "{colors.gate-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.gate}"
    padding: "10px 12px"
    height: "45px"
  timeline-lane:
    backgroundColor: "transparent"
    textColor: "{colors.gate-ink}"
    rounded: "0"
    padding: "0"
    height: "54px"
---

# Design System: CueWave

## Overview

**Creative North Star: "一条时间线，两套交通语义"**

CueWave 是一个克制、快速、可核对的观看工具。默认主题“时间登机牌”使用票纸、航站导视和虚线撕口的节奏；暗色主题“语义换乘图”使用石墨线路板、彩色 histogram 和附着于真实高峰的排名标签。两者表达的是同一条视频时间线，不是两套产品。

两个主题共享同一 DOM、内容顺序、数据、交互和可访问语义；主题只改变视觉材质，并通过浏览器本地键 `cuewave:theme` 持久化。未保存或无效值回退到默认的“时间登机牌”。探针色始终是功能性的线路标识，不能因换肤改变含义。

主流程固定为“添加并确认探针 → 分析视频 → 扫描语义时间轴与最高热点 → 跳转并核对原句”。视频解析／同步文字、历史记录和实时判断属于渐进披露的辅助能力，不与主流程争夺首屏。用户界面只描述“解析视频”和“分析视频”，不暴露字幕供应商、文件格式或以字幕作为底层判断材料的实现细节。设计全部由 HTML、CSS 和字体栈构成；仓库的 shipping 扩展不使用任何 raster 主题资产，`.impeccable/` 下的图片仅是设计与审阅证据。

**Key Characteristics:**

- 同一信息架构下的浅色登机牌与暗色换乘图双主题。
- 以时间比例、探针色和原句证据构成可核对的分析闭环。
- 紧凑侧栏优先，窄屏横向压缩，宽屏提高密度与字号而不改顺序。
- 状态诚实地区分未分析、无文本、失败和低值。
- 无 shipping raster assets；主题材质由 CSS 绘制。

## Colors

浅色主题以低饱和票纸和深海军蓝建立高密度导视；暗色主题以石墨黑和清亮青绿建立路线感。所有规范色值位于 frontmatter，组件通过同名 CSS 语义变量切换，探针色跨主题保持不变。

### Primary

- **Gate Wayfinding Navy** (`gate-ink`): 默认主题的正文、桅顶、主要按钮和强层级。
- **Transit Signal Teal** (`transit-accent`): 暗色主题的就绪状态、路线强调和交互反馈。

### Secondary

- **Probe Route Set** (`probe-teal`, `probe-coral`, `probe-violet`, `probe-pink`, `probe-blue`): 最多五个探针的稳定身份色；同一探针在卡片、时间轴、热点和播放器叠层中保持一致。
- **Gate Signal Green** (`gate-accent`): 默认主题的正向状态和强调，不承担大面积背景。

### Tertiary

- **Gate Focus Orange** (`gate-focus`) 与 **Transit Focus Yellow** (`transit-focus`): 对应主题的键盘焦点轮廓，必须始终可见。
- **Failure Reds** (`gate-danger`, `transit-danger`): 仅表示失败或错误；失败不得退化为低值。

### Neutral

- **Ticket Stock** (`gate-background`, `gate-paper`, `gate-paper-secondary`): 默认主题的外部底、票面和次级填充。
- **Station Board** (`transit-background`, `transit-paper`, `transit-paper-secondary`): 暗色主题的外部底、面板和层内填充。
- **Operational Text** (`gate-muted`, `gate-faint`, `transit-muted`, `transit-faint`): 元数据、说明和弱状态；不能取代主要正文色。
- **Structural Rules** (`gate-rule`, `gate-rule-strong`, `transit-rule`, `transit-rule-strong`): 分隔、输入边界、时间刻度和卡片结构。

**The Route Identity Rule.** 探针色标识数据系列，而不是装饰；换主题、切换视口或折叠工具时都不能重新分配。

**The Readable Teal Rule.** 浅色主题中的探针标题不直接使用明亮探针青，而以 38% 路线色混入正文墨色；暗色主题才以 82% 路线色混入白色并允许微弱辉光。

## Typography

**Display Font:** Avenir Next，回退到系统无衬线与中文系统字体  
**Body Font:** Avenir Next，回退到系统无衬线与中文系统字体  
**Label/Mono Font:** ui-monospace / SFMono-Regular / Menlo / Consolas

**Character:** 无衬线主体保持航站导视般直接，等宽字体只用于视频 ID、计数、时间和数值。层级靠字重、尺寸和轻微负字距建立，不依赖全大写制造噪声。

### Hierarchy

- **Display** (700, `clamp(18px, 5.3vw, 24px)`, 1.22): 当前视频标题；宽屏提升至 29px。
- **Headline** (700, 17px, 1.2): 分区标题；宽屏提升至 24px。
- **Title** (650–750, 13–19px): 品牌、探针名称和局部分组标题。
- **Body** (400, 13px, 1.5): 操作说明、证据和状态文案。
- **Label** (500–700, 9–12px): 元数据、图例、按钮与辅助标签；分区眉题可使用 0.13em 字距。
- **Mono** (500–700, 9–11px, tabular numerals): 时间、计数、视频 ID 和来源戳。

**The Evidence Numerals Rule.** 时间、计数和分析数值使用等宽数字，正文与原句保持人文无衬线，避免把证据阅读变成日志界面。

## Layout

默认侧栏支持 310–420px：页面最小宽度为 310px，主内容最大宽度为 420px；更宽的浏览器承载面只增加外部留白，不拉伸登机牌或线路中控。结构顺序固定为桅顶、当前视频、探针入口与线路、时间轴、原句证据、热点排名、辅助工具。

在紧凑宽度（≤370px），外侧留白降至 7px，品牌圆标和非错误顶层状态隐藏，票面内边距收紧；探针仍保持可读的单列线路，不使用会挤压名称和操作的横向卡片，分析按钮与就绪状态改为单列。信息顺序和功能均不删减。

在宽屏承载面中仍保持 420px 的工具型侧栏宽度，避免时间轴标签、证据和操作随着窗口任意拉伸。产品若未来提供独立页面，再为宽屏定义新的布局模式。

**The One Sequence Rule.** 两个主题和所有宽度共享同一 DOM、操作顺序、数据和语义；响应式规则只能重排密度，不能创建分叉流程。

## Elevation & Depth

“时间登机牌”在静止状态保持平面，通过票面色阶、边框、虚线撕口和圆形缺口建立层次，不给每块内容加阴影。“语义换乘图”以石墨面板边框和路线辉光表达活动数据，不给每个容器套模板化阴影。

### Shadow Vocabulary

- **Transit Panel:** 使用 `#334149` 结构边框区分层级，不使用常规卡片投影。
- **Active Route Glow** (`0 0 10px` / `0 0 12px`, derived from probe color): 仅用于暗色主题中的有效读数与路线标题。
- **Evidence Rule** (`inset 3px 0 var(--accent)`): 将原句证据与普通说明区分，不制造悬浮卡片。

**The Flat Ticket Rule.** 默认主题靠纸张、切口和规则线分层；阴影不是登机牌主题的常规容器语言。

## Shapes

默认主题使用接近直角的 3px 圆角、2px 来源戳和虚线分隔，票面连接处由 12px 圆形缺口形成可识别轮廓。暗色主题将主要容器切换为 11px 圆角、探针卡使用 9px 圆角，并取消票据缺口；线路编号与热点排名使用小型矩形标牌，不能以圆形站点替代 histogram。输入与“添加”按钮组成一个连续控件，只在外侧保留圆角。

## Components

### Theme Switch

- **Style:** 辅助工具区“界面外观”行中的胶囊式双按钮，使用 `aria-pressed` 表示当前主题；桅顶保留给登机牌时钟或换乘图分析状态。
- **Behavior:** 默认 `gate`；选择写入 `cuewave:theme`，本地存储变化会同步更新 DOM 属性。
- **Invariant:** 只换视觉 token，不换 DOM、文案、数据、顺序或可访问语义。

### Probe Entry

- **Shape:** 45px 高的组合输入；左侧文本框与右侧动作按钮共享外轮廓。
- **Primary:** 深色导视底与浅色文字；hover 切换到主题强调色，并使用 `action-hover-ink` 保持浅青／浅绿背景上的对比度。
- **Progressive Detail:** 用户先输入探针，再按需校准标准、正反例和 Noul／Score 类型。

### Probe Cards

- **Structure:** 探针名称、读数类型、显示开关、修改和移除；顶部 3px 线路色绑定探针身份。
- **Layout:** 侧栏使用单列线路表以保证名称和操作可读；宽屏仍保持同一顺序，不复制另一套组件。
- **State:** 隐藏仅影响可视化，卡片降为 58% 不透明度，但读数和分析任务保留。

### Analysis Command

- **Style:** 44px 高的主按钮与同区的视频解析／分析状态；其下是 3px 进度线。
- **Disclosure:** 停止、细化广告边界、保存 JSON 与用量信息收在“分析工具与用量”详情中。

### Semantic Timeline

- **Geometry:** 每个探针拥有一条 100% 宽的按钮轨道；浅色 histogram 高 45px，暗色 histogram 高 57px。分析窗口的 `left` 与 `width` 始终由开始、结束时间占视频总时长的比例计算。
- **Hit Model:** 指针点击在整条轨道上按横向比例映射到视频时间，键盘激活跳至最高热点。长视频中的有效柱可有 8px 最小可见宽度，但它只保证视觉可见性，不改变比例映射或成为独立键盘命中目标。
- **States:** 未分析、无内容、失败、低值必须使用不同图形与颜色；有效值以高度和不透明度共同编码。
- **Transit Peak Labels:** 暗色主题仍完整显示每个分析窗口的柱形分布；`rankHotspots(...).slice(0, 5)` 只生成附着在真实高柱上的矩形排名标签，不能把分布简化成站点。

### Hotspots and Evidence

- **Hotspots:** 每个探针独立排名，列表行显示时间窗、原句摘要和读数标签。
- **Evidence:** 点击轨道或热点跳转视频并在原句核对区展示判断标准、原句和时间窗口。
- **Continuity:** 结果不是终点；每个读数都应能回到原视频证据。

### Utility Drawers

- **Video Parsing and History:** 视频解析／播放器与历史记录使用折叠详情，默认不竞争主流程；同步文字是独立的观看功能，不能暗示语义探针依赖何种底层材料。
- **Live Judgment:** 作为辅助区末尾的独立入口，在新标签页打开，不进入侧栏主任务层级。

## Do's and Don'ts

### Do:

- **Do** 保持“加探针 → 分析 → 看时间轴／热点 → 跳转核对”的主流程在同一视觉序列中。
- **Do** 让两个主题复用同一 DOM、数据、顺序与可访问语义，并持久化用户的主题选择。
- **Do** 用真实分析窗口决定柱的位置，用真实热点决定暗色 histogram 上排名标签的位置。
- **Do** 在 310–620px 维持正常侧栏，在 ≤370px 使用紧凑规则，在 ≥700px 使用宽屏规则。
- **Do** 将视频解析、历史和实时判断保持为渐进披露能力。
- **Do** 用“解析视频中”和“已就绪，可以开始分析”描述准备状态，不向用户暴露字幕供应商或底层判断材料。
- **Do** 继续使用 CSS 形状、边框、渐变和系统字体构建主题；shipping UI 中没有 raster 资产。

### Don't:

- **Don't** 为暗色主题复制第二套 DOM，或让换肤改变数据、操作顺序和语义。
- **Don't** 用明亮浅青直接承载浅色票纸上的小号文字；使用混入深色正文的路线色。
- **Don't** 把暗色语义线路简化为站点，添加固定假热点，或让最小柱宽改变点击到时间的比例映射。
- **Don't** 把失败、无内容、未分析和低值合并为同一种弱状态。
- **Don't** 将 `.impeccable/` 中的参考图当作 shipping raster assets；它们只用于方向与审阅。
- **Don't** 宣称 Impeccable 固定静态 comp 与动态响应式 DOM 的像素比较门禁已经通过。该自动化门禁尚未建立，属于明确的 process debt；现有审阅截图不是其替代品。
