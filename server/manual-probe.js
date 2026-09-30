const PRESETS = {
  "具体程度": {
    reason: "衡量字幕里可核对的具体信息，而非话语听起来是否专业或可信。",
    option: {
      name: "具体程度",
      description: "target 对所谈事情给出的具体信息有多充分",
      criterion: "只看 target 是否明确交代对象、动作、方法、例子、参数、条件、约束或结果，以及这些细节之间的关系。具体例子不必带数字；专有名词、术语和肯定语气本身不算具体。context 只用于补足指代，不把前文细节计入 target；不核验陈述真实性",
      negative: "只有‘很厉害’‘提升效率’等宽泛结论，缺少可识别的对象、动作和例子。",
      middle: "出现一个具体对象、动作或例子，但关键方法、条件或结果仍然模糊。",
      positive: "明确说出谁对什么做了什么、如何做，或给出可核对的例子、参数、约束与结果。",
      primitive: "score"
    }
  },
  "实操步骤": {
    reason: "识别当前片段是否真正给出可照做的动作；单个具体步骤也算。",
    option: {
      name: "实操步骤",
      description: "target 是否给出观众能够照做的具体操作或实践方法",
      criterion: "target 至少要说明一个明确动作及其操作对象或执行条件，让人知道实际要做什么；单步也算，不要求编号或完整教程。context 可帮助理解‘它’等指代，但不能用前文的步骤替代 target。只说目标、原则、效果、工具名或‘接下来教你怎么做’，没有给出当前步骤时不算",
      positive: "‘打开设置里的字幕选项，选择中文，再点击保存’；‘先把采访录音按发言人分段’。",
      negative: "‘我们会教你优化字幕’‘这个流程非常简单’‘应该重视用户体验’，没有可执行的动作。",
      primitive: "noul"
    }
  },
  "知识科普": {
    reason: "识别当前片段是否传递可理解、可复述的知识或见闻；不以术语多少代替学习价值。",
    option: {
      name: "知识科普",
      description: "target 是否向观众讲清至少一个有助于增长知识或见闻的事实、原理、背景、方法或因果关系",
      criterion: "只根据 target 当前说出的内容判断：它需要提供至少一个具体、可复述的知识点，并给出足以理解它的信息；科学、历史、文化、技术和日常经验都可以。知识不必冷门，也不要求完整课程；实操片段若同时讲清方法或原理也可以命中。context 仅用于理解指代，不把前文知识算到 target。只预告要讲什么、堆砌未解释的术语、表达纯主观感受或空泛结论而没有知识内容时不算；不核验事实真伪，也不推断观众实际上是否学会。",
      positive: "‘镜片遇到较暖的湿空气会起雾，因为水汽在较冷表面凝结成小水滴’；解释一个历史制度的背景与作用；讲清某项技术或日常方法的原理。",
      negative: "‘今天带你了解一个神奇知识’只是预告；‘这项技术非常先进’只是口号；连续报出术语却没有解释其含义。",
      primitive: "noul"
    }
  },
  "推广信息": {
    reason: "定位各类视频中可辨认的插入口播广告；广告与原主题相关也可能命中。",
    option: {
      name: "推广信息",
      description: "target 是否属于视频正文中插入的商业口播广告段，包括该广告段的延续",
      criterion: "videoTitle 和 context 仅帮助理解视频主线、指代及广告是否已开始；广告可以与原主题相关。若 target 明确出现赞助声明、商业产品或服务的推销话术、优惠码、购买或注册引导、自家商业项目导流，且构成可辨认的推广段，则为是；若 context 已明确开启广告，而 target 仍在介绍该广告对象或优惠，也为是。仅提及品牌、正常讨论或评测视频本来讨论的对象、整支视频原本就是商业介绍但没有另插广告、非商业性的点赞订阅提醒，都不算。context 有广告但 target 已回到正文时不算；证据不足时不算",
      positive: "教程中途口播与主题相关的赞助工具并给出优惠码；访谈暂停讨论，主持人推荐自己的付费课程；娱乐视频插入商店购买引导；已开始的广告段继续介绍同一优惠。",
      negative: "访谈自然讨论某品牌；评测视频继续评价本来就在评测的产品；只请观众点赞订阅；前文是广告但当前片段已经回到原话题。",
      primitive: "noul"
    }
  },
  "幽默程度": {
    reason: "只评估字幕中的幽默表达线索，不宣称观众一定会发笑。",
    option: {
      name: "幽默程度",
      description: "target 中可辨认的幽默表达有多强",
      criterion: "根据 target 自身的双关、反转、荒诞反差、夸张、自嘲、调侃或包袱结构评分；context 只帮助理解铺垫。说‘这很好笑’或出现笑声文字，不等于 target 本身有笑点；不能推断真实观众是否笑了",
      negative: "平直的信息陈述，或只说‘讲个笑话’却没有实际幽默内容。",
      middle: "有轻度调侃、夸张或俏皮措辞，但笑点不完整或不突出。",
      positive: "有清晰的反转、双关、荒诞对比或完整包袱，幽默效果在文字中可以辨认。",
      primitive: "score"
    }
  },
  "buzzword含量": {
    reason: "按用户所说的‘艰深专业词汇堆砌’定义；不等同于虚假或没有技术含量。",
    option: {
      name: "buzzword含量",
      description: "target 中难懂的专业术语、行业概念和缩写的堆砌程度",
      criterion: "看 target 中未解释的专业术语、英文缩写、抽象行业概念是否密集出现并遮蔽具体意思。单个必要术语、已经解释的术语，或用专业词准确说明方法，不自动算高；不判断技术是否真实，也不把普通长句当成术语堆砌",
      negative: "主要用日常语言表达，或少量术语随即得到清楚解释。",
      middle: "出现几个专业词或缩写，但仍能看出明确对象、方法或它们之间的关系。",
      positive: "连续堆叠多项未解释的术语、缩写或抽象概念，让片段几乎无法看出具体在做什么。",
      primitive: "score"
    }
  },
  "无聊程度": {
    reason: "只评估字幕里的注意力流失风险线索，不推测真实观众的心理状态。",
    option: {
      name: "无聊程度",
      description: "target 在文字表达上缺少新信息或推进、可能使观众失去注意力的程度",
      criterion: "根据 target 是否反复说同一结论、空泛铺陈、冗长过渡或偏离主题，却几乎没有新增事实、动作、对比、问题或叙事推进来评分。平静语气、专业难度或个人不感兴趣本身不算无聊；字幕无法反映画面、声音和真实观看反应",
      negative: "片段持续给出新信息、具体动作、明确对比或叙事推进，即使表达平静。",
      middle: "有一定新信息，但夹杂重复、空泛过渡或不必要的绕圈。",
      positive: "大部分内容重复或空泛，长时间没有新增信息、具体行动或话题推进。",
      primitive: "score"
    }
  },
  "信息量程度": {
    reason: "衡量当前片段提供的可复述新信息；不把趣味性、术语数量或语速当作信息量。",
    option: {
      name: "信息量程度",
      description: "target 为当前话题提供了多少明确、可复述的新信息",
      criterion: "根据 target 新增的事实、对象、机制、因果、方法、例子、数字、限制或结果，以及它们之间的关系评分。context 只用于理解指代和识别重复，不把前文信息计入 target。一个解释充分的重要知识点也可以是高信息量，不按字数或术语数量机械评分；平静的讲解可高信息量，生动的表达也可低信息量。只评估文字中可提取的新信息，不核验事实真伪，也不推断观众是否觉得有趣。",
      negative: "主要重复已说内容、表达情绪或空泛结论，没有明确可复述的新信息。",
      middle: "有一项明确的新信息或具体细节，但缺少解释、关联或进一步展开；或信息与重复内容混杂。",
      positive: "给出多个相互关联的具体新信息，或清楚解释一个重要事实、机制、方法或例子，让人能具体复述学到了什么。",
      primitive: "score"
    }
  },
  "空洞概念": {
    reason: "观察缺少解释或落地支撑的抽象主张；不等同于专业术语多，也不判断陈述真假。",
    option: {
      name: "空洞概念",
      description: "target 用缺少可核对支撑的抽象概念或宏大主张替代具体说明的程度",
      criterion: "观察 target 是否用愿景、赋能、生态、颠覆等抽象概念或宏大效果主张代替对象、做法、例子、约束或可检验结果。不能因使用专业术语、讲愿景或暂未展示证据就自动判为高；若同段明确解释如何实现、服务谁或用什么验证，应降低分数。只判断表达的空泛程度，不推断项目真实能力或说话人诚实与否；context 仅补足指代。",
      negative: "即使使用行业概念，也明确说出对象、具体做法、例子、约束或验证方式。",
      middle: "提出抽象主张，同时给出少量对象或实现线索，但关键机制仍不清楚。",
      positive: "连续使用宏大概念或效果口号，却没有交代服务对象、实现方法、可核对例子或验证方式。",
      primitive: "score"
    }
  }
};

const NEGATIVE_PRESETS = new Set(["推广信息", "buzzword含量", "无聊程度", "空洞概念"]);

function normalizeIntent(input) {
  return String(input || "").trim()
    .replace(/^(?:我想找(?:到)?|我想看(?:到)?|我不想看(?:到)?|我不想听(?:到)?|帮我找(?:到)?|找出|定位|识别)\s*[：:，,]?\s*/u, "")
    .replace(/^(?:视频(?:里|中)?|内容(?:里|中)?|片段(?:里|中)?)\s*/u, "")
    .trim();
}

function prefersScore(phrase) {
  return /(?:程度|含量|密度|强度|水平|质量|频率|多不多|有多|是否太|高低|多少)/u.test(phrase);
}

export function draftManualProbe(input, { polarity } = {}) {
  const phrase = String(input || "").trim();
  if (!phrase || phrase.length > 400) throw new Error("请输入不超过 400 字的探针描述");
  const intent = normalizeIntent(phrase);
  if (!intent) throw new Error("请说明想寻找或不想看到的内容");
  const presetName = intent === "推广信号" ? "推广信息" : intent;
  const preset = PRESETS[presetName];
  if (preset) return { ambiguous: false, manual: true, reason: preset.reason,
    options: [{ ...preset.option, polarity: ["positive", "negative"].includes(polarity) ? polarity : NEGATIVE_PRESETS.has(presetName) ? "negative" : "positive" }] };
  const primitive = prefersScore(intent) ? "score" : "noul";
  const direction = polarity === "negative" ? "negative" : "positive";
  const option = primitive === "score" ? {
    name: intent.slice(0, 40),
    description: `target 中「${intent}」这一语言现象的表现强度`,
    criterion: `只根据 target 中可以直接观察到的措辞、信息与表达结构，评估「${intent}」的强弱；context 仅用于理解指代与话题延续，不把 context 本身计入当前读数。不核验事实真伪，也不推断画面、语气或观众心理。`,
    positive: `target 持续或多次出现支持「${intent}」的明确语言证据，构成主要表达特征。`,
    middle: `target 出现部分支持「${intent}」的语言证据，但强度有限、持续时间短或同时存在相反线索。`,
    negative: `target 没有出现支持「${intent}」的明确语言证据，或只有无法构成该特征的轻微关联。`,
    primitive
  } : {
    name: intent.slice(0, 40),
    description: `target 是否明确出现或表达「${intent}」`,
    criterion: `只判断 target 本身是否存在足以支持「${intent}」的明确语言证据；context 仅用于理解指代与话题延续，不能用前文证据替代 target。仅仅提到相关词、预告之后会谈到或需要依赖画面和语气推断时，不算命中；不核验事实真伪。`,
    positive: `target 直接表达「${intent}」，或给出能够明确支持该判断的具体语言证据。`,
    negative: `target 没有表达「${intent}」，只有模糊关联、关键词偶然出现、话题预告或证据仅存在于 context。`,
    primitive
  };
  return {
    ambiguous: false,
    manual: true,
    reason: "CueWave 已根据需求生成基础定义；如有特殊判断边界，可在高级设置中修改。",
    options: [{ ...option, polarity: direction }]
  };
}
