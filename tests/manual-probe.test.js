import test from "node:test";
import assert from "node:assert/strict";
import { draftManualProbe } from "../server/manual-probe.js";

test("manual draft needs no Gemini result and stays editable for Jev", () => {
  const result = draftManualProbe("  实操步骤  ");
  assert.equal(result.manual, true);
  assert.equal(result.ambiguous, false);
  assert.equal(result.options.length, 1);
  assert.equal(result.options[0].name, "实操步骤");
  assert.equal(result.options[0].primitive, "noul");
  assert.equal(result.options[0].polarity, "positive");
  assert.match(result.options[0].criterion, /单步也算/);
  assert.match(result.options[0].negative, /没有可执行的动作/);
  for (const field of ["description", "criterion", "positive", "negative"]) assert.ok(result.options[0][field]);
});

test("specificity uses an explicit three-level Score rubric without mistaking jargon for detail", () => {
  const probe = draftManualProbe("具体程度").options[0];
  assert.equal(probe.primitive, "score");
  assert.match(probe.criterion, /术语和肯定语气本身不算具体/);
  assert.match(probe.criterion, /不核验陈述真实性/);
  for (const field of ["negative", "middle", "positive"]) assert.ok(probe[field]);
});

test("new subjective and jargon probes have distinct observable Score rubrics", () => {
  const expected = [
    ["幽默程度", /不能推断真实观众是否笑了/, /反转/],
    ["buzzword含量", /不判断技术是否真实/, /术语/],
    ["无聊程度", /真实观看反应/, /没有新增信息/]
  ];
  for (const [name, boundary, high] of expected) {
    const probe = draftManualProbe(name).options[0];
    assert.equal(probe.name, name);
    assert.equal(probe.primitive, "score");
    assert.match(probe.criterion, boundary);
    assert.match(probe.positive, high);
    for (const field of ["description", "criterion", "negative", "middle", "positive"]) assert.ok(probe[field]);
  }
});

test("manual draft rejects empty or oversized probe input", () => {
  assert.throws(() => draftManualProbe("   "), /请输入/);
  assert.throws(() => draftManualProbe("字".repeat(401)), /请输入/);
});

test("free-form intent compiles into a usable binary probe without a model", () => {
  const result = draftManualProbe("我不想看到视频里重复的自我介绍", { polarity: "negative" });
  const probe = result.options[0];
  assert.equal(result.manual, true);
  assert.equal(probe.name, "重复的自我介绍");
  assert.equal(probe.primitive, "noul");
  assert.equal(probe.polarity, "negative");
  assert.match(probe.description, /重复的自我介绍/);
  assert.match(probe.criterion, /target/);
  assert.ok(probe.positive);
  assert.ok(probe.negative);
});

test("degree-like free-form intent compiles into a three-level score probe", () => {
  const probe = draftManualProbe("信息密度").options[0];
  assert.equal(probe.name, "信息密度");
  assert.equal(probe.primitive, "score");
  assert.equal(probe.polarity, "positive");
  for (const field of ["negative", "middle", "positive"]) assert.ok(probe[field]);
});

test("explicit intent direction overrides a preset default", () => {
  assert.equal(draftManualProbe("推广信息", { polarity: "positive" }).options[0].polarity, "positive");
  assert.equal(draftManualProbe("知识科普", { polarity: "negative" }).options[0].polarity, "negative");
});

test("promotion probe finds spoken ad inserts across video genres", () => {
  for (const input of ["推广信息", "推广信号"]) {
    const result = draftManualProbe(input);
    const probe = result.options[0];
    assert.equal(probe.name, "推广信息");
    assert.equal(probe.primitive, "noul");
    assert.equal(probe.polarity, "negative");
    assert.match(probe.criterion, /videoTitle/);
    assert.match(probe.criterion, /广告可以与原主题相关/);
    assert.match(probe.criterion, /context 已明确开启广告/);
    assert.match(probe.criterion, /target 已回到正文时不算/);
    assert.match(probe.positive, /教程/);
    assert.match(probe.positive, /访谈/);
    assert.match(probe.positive, /娱乐视频/);
    assert.match(probe.positive, /自己的付费课程/);
    assert.match(probe.negative, /本来就在评测的产品/);
    assert.match(probe.negative, /点赞订阅/);
  }
});

test("preset polarity separates desirable signals from signals to avoid", () => {
  for (const name of ["知识科普", "具体程度", "实操步骤", "幽默程度", "信息量程度"]) {
    assert.equal(draftManualProbe(name).options[0].polarity, "positive", name);
  }
  for (const name of ["推广信息", "buzzword含量", "无聊程度", "空洞概念"]) {
    assert.equal(draftManualProbe(name).options[0].polarity, "negative", name);
  }
});

test("knowledge probe identifies teachable information rather than jargon or a topic preview", () => {
  const result = draftManualProbe("知识科普");
  const probe = result.options[0];
  assert.equal(result.manual, true);
  assert.equal(probe.name, "知识科普");
  assert.equal(probe.primitive, "noul");
  assert.match(probe.description, /知识|见闻/);
  assert.match(probe.criterion, /target/);
  assert.match(probe.criterion, /context/);
  assert.match(probe.criterion, /事实真伪/);
  assert.match(probe.criterion, /术语/);
  assert.match(probe.positive, /原理|背景|知识/);
  assert.match(probe.negative, /预告|口号/);
});
