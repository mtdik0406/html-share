import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSafeToApply, planSync, type SyncPlan } from "../scripts/lib/sync-plan.js";

describe("planSync", () => {
  it("新しいキーは add、ETag と MD5 が同じなら unchanged、違えば update、手元に無いキーは remove", () => {
    const plan = planSync(
      [
        { key: "pages/new/index.html", md5: "aaa" },
        { key: "pages/same/index.html", md5: "bbb" },
        { key: "pages/changed/index.html", md5: "ccc" },
      ],
      [
        { key: "pages/same/index.html", etag: '"bbb"' },
        { key: "pages/changed/index.html", etag: '"old"' },
        { key: "pages/gone/index.html", etag: '"ddd"' },
      ],
    );
    assert.deepEqual(plan, {
      add: ["pages/new/index.html"],
      update: ["pages/changed/index.html"],
      unchanged: ["pages/same/index.html"],
      remove: ["pages/gone/index.html"],
    });
  });

  it("ETag の大文字・小文字の違いは同じとみなす", () => {
    const plan = planSync([{ key: "k", md5: "abcdef" }], [{ key: "k", etag: '"ABCDEF"' }]);
    assert.deepEqual(plan.unchanged, ["k"]);
  });

  it("マルチパートの ETag（-N 付き）は MD5 と一致しないので置き直す", () => {
    const plan = planSync([{ key: "k", md5: "abc" }], [{ key: "k", etag: '"abc-2"' }]);
    assert.deepEqual(plan.update, ["k"]);
  });
});

describe("assertSafeToApply", () => {
  const plan = (keep: number, remove: number): SyncPlan => ({
    add: [],
    update: [],
    unchanged: Array.from({ length: keep }, (_, i) => `keep-${i}`),
    remove: Array.from({ length: remove }, (_, i) => `remove-${i}`),
  });
  const deny = { allowMassDelete: false };
  const allow = { allowMassDelete: true };

  it("公開するページが 0 なら、フラグがあっても止める", () => {
    assert.throws(() => assertSafeToApply(plan(0, 1), 1, allow));
    assert.throws(() => assertSafeToApply(plan(0, 0), 0, allow));
  });

  it("削除がなければ通る", () => {
    assert.doesNotThrow(() => assertSafeToApply(plan(3, 0), 3, deny));
  });

  it("2 割未満の削除は通る（6 ページのうち 1）", () => {
    assert.doesNotThrow(() => assertSafeToApply(plan(5, 1), 6, deny));
  });

  it("2 割ちょうどの削除は止める（5 ページのうち 1）", () => {
    assert.throws(() => assertSafeToApply(plan(4, 1), 5, deny));
  });

  it("フラグがあれば 2 割以上の削除も通る", () => {
    assert.doesNotThrow(() => assertSafeToApply(plan(1, 4), 5, allow));
  });
});
