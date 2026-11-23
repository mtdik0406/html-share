import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isExpired } from "../../../cli/lib/retention.js";

/** 手元の時刻帯で、その日の時刻を作る。テストを実行する時刻帯に依らないようにするため。 */
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe("isExpired", () => {
  it("期限がなければ、期限切れにならない", () => {
    assert.equal(isExpired(undefined, local(2999, 1, 1)), false);
  });

  it("その日の終わりまでは公開する", () => {
    assert.equal(isExpired("2026-12-31", local(2026, 12, 31, 0, 0)), false);
    assert.equal(isExpired("2026-12-31", local(2026, 12, 31, 23, 59)), false);
  });

  it("次の日の始まりから期限切れになる", () => {
    assert.equal(isExpired("2026-12-31", local(2027, 1, 1, 0, 0)), true);
  });

  it("前の日は期限切れにならない", () => {
    assert.equal(isExpired("2026-12-31", local(2026, 12, 30, 23, 59)), false);
  });
});
