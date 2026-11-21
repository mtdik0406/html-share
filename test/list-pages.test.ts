// S3 の一覧から、管理画面に出すページを選ぶ。sync が置く形のキーだけを、ページとして扱う。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageEntries } from "../lib/admin/list-pages.js";

describe("pageEntries", () => {
  it("ページのキーだけを、slug と更新時刻にして返す", () => {
    const at = new Date("2030-01-02T03:04:05Z");
    assert.deepEqual(
      pageEntries([
        { key: "pages/page-a/index.html", etag: '"1"', lastModified: at },
        { key: "pages/page-a/other.html", etag: '"2"', lastModified: at },
        { key: "pages/Bad_Slug/index.html", etag: '"3"', lastModified: at },
        { key: "pages/a/b/index.html", etag: '"4"', lastModified: at },
      ]),
      [{ slug: "page-a", lastModified: "2030-01-02T03:04:05.000Z" }],
    );
  });

  it("更新時刻が分からないページは、空の文字列にして返す", () => {
    assert.deepEqual(pageEntries([{ key: "pages/page-a/index.html", etag: '"1"' }]), [
      { slug: "page-a", lastModified: "" },
    ]);
  });
});
