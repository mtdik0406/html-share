import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateLifetimeMs } from "../../core/lifetime.js";

describe("validateLifetimeMs（CLI 以外からも使う期限の検証）", () => {
  const DAY = 86_400_000;
  it("1 分ちょうどと 30 日ちょうどは通る", () => {
    assert.doesNotThrow(() => validateLifetimeMs(60_000));
    assert.doesNotThrow(() => validateLifetimeMs(30 * DAY));
  });
  for (const [label, ms] of [
    ["1 分未満", 59_999],
    ["30 日を超える", 30 * DAY + 1],
    ["数値でない", Number.NaN],
    ["無限大", Number.POSITIVE_INFINITY],
  ] as const) {
    it(`${label} はエラー`, () => {
      assert.throws(() => validateLifetimeMs(ms));
    });
  }
});
