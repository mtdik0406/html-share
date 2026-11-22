import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSlug, PAGES_PREFIX, pageKey, pageUrl } from "../core/page.js";

describe("assertSlug", () => {
  for (const [label, slug] of [
    ["英小文字とハイフン", "page-a"],
    ["1 文字", "a"],
    ["数字で始まる", "2026-report"],
    ["64 文字（上限ちょうど）", "a".repeat(64)],
  ] as const) {
    it(`${label} は通る`, () => {
      assert.doesNotThrow(() => assertSlug(slug));
    });
  }

  for (const [label, slug] of [
    ["未指定", undefined],
    ["空文字", ""],
    ["ハイフンで始まる", "-a"],
    ["大文字を含む", "Page"],
    ["スラッシュを含む", "a/b"],
    ["親ディレクトリへの移動", "../x"],
    ["空白を含む", "a b"],
    ["65 文字（上限超え）", "a".repeat(65)],
  ] as const) {
    it(`${label} はエラー`, () => {
      assert.throws(() => assertSlug(slug));
    });
  }
});

describe("pageKey / pageUrl", () => {
  const domain = "d111.cloudfront.net";

  it("URL のパスが S3 のキーと一致する（CloudFront はパスをそのままキーとして読む）", () => {
    const url = new URL(pageUrl(domain, "page-a"));
    assert.equal(url.pathname, `/${pageKey("page-a")}`);
  });

  it("HTTPS で、指定したドメインを指す", () => {
    const url = new URL(pageUrl(domain, "page-a"));
    assert.equal(url.protocol, "https:");
    assert.equal(url.host, domain);
  });

  it("キーは同期が扱う接頭辞の下にある（外れると、設定から消しても S3 から消えない）", () => {
    assert.ok(pageKey("page-a").startsWith(PAGES_PREFIX));
  });

  it("slug が違えばキーも違う", () => {
    assert.notEqual(pageKey("page-a"), pageKey("page-b"));
  });
});
