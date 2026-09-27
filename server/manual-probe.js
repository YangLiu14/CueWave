export function draftManualProbe(input) {
  const phrase = String(input || "").trim();
  if (!phrase || phrase.length > 400) throw new Error("请输入不超过 400 字的探针描述");
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
