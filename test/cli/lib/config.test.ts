import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseConfig } from "../../../cli/lib/config.js";

const configDir = "/work/conf";
const home = "/u/me";
const parse = (data: unknown) => parseConfig(JSON.stringify(data), configDir, home);

describe("parseConfig: 広すぎる roots", () => {
  const protectedDirs = [home, "/work/repo"];
  const parseRoots = (roots: string[]) =>
    parseConfig(JSON.stringify({ roots, pages: [] }), configDir, home, protectedDirs);

  for (const root of ["~", "/", "/u", "/work", "/work/repo", "/work/repo/"]) {
    it(`${root} はエラー（ホームやリポジトリを丸ごと公開できる範囲にしない）`, () => {
      assert.throws(() => parseRoots([root]));
    });
  }

  for (const root of ["~/pages", "/work/repo/samples", "/work/other"]) {
    it(`${root} は通る`, () => {
      assert.doesNotThrow(() => parseRoots([root]));
    });
  }

  it("守るディレクトリを渡さなくても、ホームは拒否する", () => {
    assert.throws(() => parseConfig(JSON.stringify({ roots: ["~"], pages: [] }), configDir, home));
  });
});

describe("parseConfig", () => {
  it("相対パスは設定ファイルのディレクトリから、~/ はホームから解決する", () => {
    const config = parse({
      roots: ["pages", "~/shared", "/abs"],
      pages: [{ slug: "a", source: "pages/a/index.html" }],
    });
    assert.deepEqual(config, {
      roots: ["/work/conf/pages", "/u/me/shared", "/abs"],
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
    ["ページがオブジェクトでない", { roots: ["."], pages: ["a.html"] }],
    ["roots に文字列でない値", { roots: [1], pages: [] }],
    ["ページに知らないキー", { roots: ["."], pages: [{ slug: "a", source: "a.html", day: 3 }] }],
  ] as const) {
    it(`${label} はエラー`, () => {
      const text = data === undefined ? "{ roots: [" : JSON.stringify(data);
      assert.throws(() => parseConfig(text, configDir, home));
    });
  }
});

describe("parseConfig: retainUntil", () => {
  const parsePage = (page: Record<string, unknown>) =>
    parse({ roots: ["."], pages: [{ slug: "a", source: "a.html", ...page }] }).pages[0];

  it("書いた日付をそのまま持つ", () => {
    assert.equal(parsePage({ retainUntil: "2026-12-31" })?.retainUntil, "2026-12-31");
  });

  it("書かなければ期限はない", () => {
    assert.equal(parsePage({})?.retainUntil, undefined);
  });

  for (const value of ["2024-02-29", "2026-01-01"]) {
    it(`${value} は通る（実在する日付）`, () => {
      assert.doesNotThrow(() => parsePage({ retainUntil: value }));
    });
  }

  for (const value of [
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-1-1",
    "2026-12-31T00:00:00Z",
    " 2026-12-31",
    "",
    20261231,
  ]) {
    it(`${JSON.stringify(value)} はエラー`, () => {
      assert.throws(() => parsePage({ retainUntil: value }));
    });
  }
});
