import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DAYS,
  MAX_DAYS,
  parseLifetimeMs,
  validateLifetimeMs,
} from "../scripts/lib/lifetime.js";

const MINUTE = 60_000;
const DAY = 86_400_000;

describe("parseLifetimeMs", () => {
  it("どちらも未指定なら既定の日数", () => {
    assert.equal(parseLifetimeMs({}), DEFAULT_DAYS * DAY);
  });

  it("--minutes 1（下限ちょうど）は通る", () => {
    assert.equal(parseLifetimeMs({ minutes: "1" }), MINUTE);
  });

  it("--days の上限ちょうどは通る", () => {
    assert.equal(parseLifetimeMs({ days: String(MAX_DAYS) }), MAX_DAYS * DAY);
  });

  it("小数の日数も使える", () => {
    assert.equal(parseLifetimeMs({ days: "0.5" }), 0.5 * DAY);
  });

  for (const [name, options] of [
    ["両方の指定", { days: "1", minutes: "1" }],
    ["空の --minutes（黙って既定値にしない）", { minutes: "" }],
    ["空白だけの --days", { days: "  " }],
    ["数値でない値", { days: "abc" }],
    ["0", { minutes: "0" }],
    ["負の数", { days: "-1" }],
    ["1 分未満", { minutes: "0.5" }],
    ["上限を超える", { days: String(MAX_DAYS + 1) }],
  ] as const) {
    it(`${name} はエラー`, () => {
      assert.throws(() => parseLifetimeMs(options));
    });
  }
});

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
