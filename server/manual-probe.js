export function draftManualProbe(input) {
  const phrase = String(input || "").trim();
  if (!phrase || phrase.length > 400) throw new Error("请输入不超过 400 字的探针描述");
  if (phrase === "推广信息" || phrase === "推广信号") {
    return {
      ambiguous: false,
      manual: true,
      reason: "定位各类视频中可辨认的插入口播广告；广告与原主题相关也可能命中。",
      options: [{
        name: "推广信息",
        description: "target 是否属于视频正文中插入的商业口播广告段，包括该广告段的延续",
        criterion: "videoTitle 和 context 仅帮助理解视频主线、指代及广告是否已开始；广告可以与原主题相关。若 target 明确出现赞助声明、商业产品或服务的推销话术、优惠码、购买或注册引导、自家商业项目导流，且构成可辨认的推广段，则为是；若 context 已明确开启广告，而 target 仍在介绍该广告对象或优惠，也为是。仅提及品牌、正常讨论或评测视频本来讨论的对象、整支视频原本就是商业介绍但没有另插广告、非商业性的点赞订阅提醒，都不算。context 有广告但 target 已回到正文时不算；证据不足时不算",
        positive: "教程中途口播与主题相关的赞助工具并给出优惠码；访谈暂停讨论，主持人推荐自己的付费课程；娱乐视频插入商店购买引导；已开始的广告段继续介绍同一优惠。",
        negative: "访谈自然讨论某品牌；评测视频继续评价本来就在评测的产品；只请观众点赞订阅；前文是广告但当前片段已经回到原话题。",
        primitive: "noul"
      }]
    };
  }
  return {
    ambiguous: false,
    manual: true,
    reason: "Gemini 暂停；以下只是可编辑草稿，未进行歧义检查。",
    options: [{
      name: phrase.slice(0, 40),
      description: phrase,
      criterion: `只根据目标字幕判断是否明确表达「${phrase}」，不核验事实真伪。`,
      positive: `目标字幕有明确支持「${phrase}」的语言线索。`,
      negative: `目标字幕没有明确支持「${phrase}」的语言线索。`,
      primitive: "noul"
    }]
  };
}
