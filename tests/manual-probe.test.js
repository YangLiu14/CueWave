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
