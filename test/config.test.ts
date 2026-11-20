import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseConfig } from "../scripts/lib/config.js";

const configDir = "/work/conf";
const home = "/home/me";
const parse = (data: unknown) => parseConfig(JSON.stringify(data), configDir, home);

describe("parseConfig", () => {
  it("相対パスは設定ファイルのディレクトリから、~/ はホームから解決する", () => {
    const config = parse({
      roots: ["pages", "~/shared", "/abs"],
      pages: [{ slug: "a", source: "pages/a/index.html" }],
    });
    assert.deepEqual(config, {
      roots: ["/work/conf/pages", "/home/me/shared", "/abs"],
      pages: [{ slug: "a", source: "/work/conf/pages/a/index.html" }],
    });
  });

  it("pages は空でも読める（空のまま同期するのは、同期の側で止める）", () => {
    assert.deepEqual(parse({ roots: ["."], pages: [] }).pages, []);
  });

  for (const [label, data] of [
    ["JSON でない", undefined],
    ["roots がない", { pages: [] }],
    ["roots が空", { roots: [], pages: [] }],
    ["pages が配列でない", { roots: ["."], pages: {} }],
    ["slug が不正", { roots: ["."], pages: [{ slug: "A/B", source: "a.html" }] }],
    ["source が空", { roots: ["."], pages: [{ slug: "a", source: "" }] }],
    [
      "slug が重複",
      {
        roots: ["."],
        pages: [
          { slug: "a", source: "a.html" },
          { slug: "a", source: "b.html" },
        ],
      },
    ],
    ["知らないキー（綴りの誤り）", { roots: ["."], page: [] }],
    ["ページに知らないキー", { roots: ["."], pages: [{ slug: "a", source: "a.html", day: 3 }] }],
  ] as const) {
    it(`${label} はエラー`, () => {
      const text = data === undefined ? "{ roots: [" : JSON.stringify(data);
      assert.throws(() => parseConfig(text, configDir, home));
    });
  }
});
