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
  assert.match(result.options[0].criterion, /实操步骤/);
  for (const field of ["description", "criterion", "positive", "negative"]) assert.ok(result.options[0][field]);
});

test("manual draft rejects empty or oversized probe input", () => {
  assert.throws(() => draftManualProbe("   "), /请输入/);
  assert.throws(() => draftManualProbe("字".repeat(401)), /请输入/);
});

test("promotion probe finds spoken ad inserts across video genres", () => {
  for (const input of ["推广信息", "推广信号"]) {
    const result = draftManualProbe(input);
    const probe = result.options[0];
    assert.equal(probe.name, "推广信息");
    assert.equal(probe.primitive, "noul");
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
