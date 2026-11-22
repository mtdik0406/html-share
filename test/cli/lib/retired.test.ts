import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertNoRecentReuse, parseRetired, recordRetired } from "../../../cli/lib/retired.js";

const DAY = 86_400_000;
const retiredAt = new Date("2026-11-01T00:00:00Z");
const after = (ms: number) => new Date(retiredAt.getTime() + ms);

describe("assertNoRecentReuse", () => {
  const retired = { old: retiredAt.toISOString() };

  it("取り下げてから 30 日未満の slug を使うとエラー（古い署名付き URL がまだ有効なため）", () => {
    assert.throws(() => assertNoRecentReuse(["old"], retired, after(30 * DAY - 1)));
  });

  it("30 日たてば使える", () => {
    assert.doesNotThrow(() => assertNoRecentReuse(["old"], retired, after(30 * DAY)));
  });

  it("取り下げていない slug は使える", () => {
    assert.doesNotThrow(() => assertNoRecentReuse(["new"], retired, after(DAY)));
  });
});

describe("recordRetired", () => {
  it("消した slug を、消した時刻で記録する", () => {
    const now = after(0);
    assert.deepEqual(recordRetired({}, ["a"], now), { a: now.toISOString() });
  });

  it("30 日たった記録は捨て、それ以外は残す", () => {
    const recorded = { stale: retiredAt.toISOString(), recent: after(10 * DAY).toISOString() };
    const now = after(30 * DAY);
    assert.deepEqual(recordRetired(recorded, ["b"], now), {
      recent: after(10 * DAY).toISOString(),
      b: now.toISOString(),
    });
  });

  it("元の記録を書き換えない", () => {
    const recorded = { a: retiredAt.toISOString() };
    recordRetired(recorded, ["b"], after(DAY));
    assert.deepEqual(recorded, { a: retiredAt.toISOString() });
  });
});

describe("parseRetired", () => {
  it("slug と時刻の組を読む", () => {
    assert.deepEqual(parseRetired('{"a":"2026-11-01T00:00:00.000Z"}'), {
      a: "2026-11-01T00:00:00.000Z",
    });
  });

  for (const [label, text] of [
    ["JSON でない", "{"],
    ["オブジェクトでない", "[]"],
    ["時刻として読めない値", '{"a":"x"}'],
  ] as const) {
    it(`${label} はエラー（記録が壊れたまま再利用の判定を素通りさせない）`, () => {
      assert.throws(() => parseRetired(text));
    });
  }
});
