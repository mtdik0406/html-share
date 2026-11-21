import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { type DefaultTreeAdapterTypes, parse } from "parse5";
import {
  classifyReference,
  type EmbedLimits,
  embedPage,
  parseSrcset,
} from "../scripts/lib/embed.js";

type Element = DefaultTreeAdapterTypes.Element;

let base: string;
let root: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "embed-test-"));
  root = join(base, "root");
  mkdirSync(root);
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function write(relPath: string, content: string | Buffer, dir = root): string {
  const file = join(dir, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

function page(body: string, head = ""): string {
  return write(
    "index.html",
    `<!doctype html><html><head>${head}</head><body>${body}</body></html>`,
  );
}

function embed(source: string, limits?: EmbedLimits) {
  const result = embedPage(source, [root], limits);
  return { ...result, html: result.html.toString("utf8") };
}

function elements(html: string, tag: string): Element[] {
  const found: Element[] = [];
  const visit = (node: DefaultTreeAdapterTypes.ParentNode) => {
    for (const child of node.childNodes) {
      if (!("tagName" in child)) continue;
      if (child.tagName === tag) found.push(child);
      visit(child);
    }
  };
  visit(parse(html));
  return found;
}

function attr(html: string, tag: string, name: string, index = 0): string | undefined {
  return elements(html, tag)[index]?.attrs.find((a) => a.name === name)?.value;
}

function decodeDataUri(uri: string): { mime: string; body: string } {
  const match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.*)$/s.exec(uri);
  assert.ok(match, `data URI ではありません: ${uri.slice(0, 60)}`);
  return { mime: match[1] ?? "", body: Buffer.from(match[2] ?? "", "base64").toString("utf8") };
}

describe("embedPage: 埋め込み", () => {
  it("img の相対パスを、元のファイルと同じ中身の data URI にする", () => {
    write("img/a.png", "PNGDATA");
    const { html } = embed(page('<img src="img/a.png" alt="a">'));
    const uri = attr(html, "img", "src") ?? "";
    assert.deepEqual(decodeDataUri(uri), { mime: "image/png", body: "PNGDATA" });
    assert.equal(attr(html, "img", "alt"), "a");
  });

  it("script の src を JS の data URI にし、defer などの属性は残す", () => {
    write("app.js", "console.log(1)");
    const { html } = embed(page('<script defer src="./app.js"></script>'));
    assert.deepEqual(decodeDataUri(attr(html, "script", "src") ?? ""), {
      mime: "text/javascript",
      body: "console.log(1)",
    });
    assert.equal(attr(html, "script", "defer"), "");
  });

  it("link rel=stylesheet を埋め込み、CSS の中の url() はその CSS ファイルを起点に解決する", () => {
    write("css/bg.png", "BG");
    write("css/site.css", "body { background: url(bg.png) }");
    const { html } = embed(page("", '<link rel="stylesheet" href="css/site.css">'));
    const css = decodeDataUri(attr(html, "link", "href") ?? "");
    assert.equal(css.mime, "text/css");
    const inner = /url\("([^"]+)"\)/.exec(css.body)?.[1] ?? "";
    assert.deepEqual(decodeDataUri(inner), { mime: "image/png", body: "BG" });
  });

  it("CSS の @import を中まで埋め込む", () => {
    write("b.css", ".b { color: red }");
    write("a.css", '@import "b.css";');
    const { html } = embed(page("", '<link rel="stylesheet" href="a.css">'));
    const outer = decodeDataUri(attr(html, "link", "href") ?? "").body;
    const inner = /@import url\("([^"]+)"\)/.exec(outer)?.[1] ?? "";
    assert.equal(decodeDataUri(inner).body, ".b { color: red }");
  });

  it("<style> と style 属性の url() も埋め込む", () => {
    write("x.png", "X");
    const { html } = embed(
      page(
        "<div style=\"background: url('x.png')\"></div>",
        "<style>p{background:url(x.png)}</style>",
      ),
    );
    assert.match(attr(html, "div", "style") ?? "", /url\("data:image\/png;base64,/);
    const styleText = elements(html, "style")[0]?.childNodes[0];
    assert.ok(styleText && "value" in styleText);
    assert.match(styleText.value, /url\("data:image\/png;base64,/);
  });

  it("srcset の各候補を埋め込み、記述子を残す", () => {
    write("a.png", "A");
    write("b.png", "B");
    const { html } = embed(page('<img srcset="a.png 1x, b.png 2x" src="a.png">'));
    const candidates = parseSrcset(attr(html, "img", "srcset") ?? "");
    assert.deepEqual(
      candidates.map((c) => [decodeDataUri(c.url).body, c.descriptors]),
      [
        ["A", "1x"],
        ["B", "2x"],
      ],
    );
  });

  it("同じ素材を何度参照しても、どの参照も埋め込む", () => {
    write("a.png", "A");
    write("a.css", "p { background: url(a.png) }");
    const { html } = embed(
      page(
        '<img src="a.png"><img src="./a.png">',
        '<link rel="stylesheet" href="a.css"><style>@import "a.css";</style>',
      ),
    );
    assert.equal(decodeDataUri(attr(html, "img", "src", 0) ?? "").body, "A");
    assert.equal(decodeDataUri(attr(html, "img", "src", 1) ?? "").body, "A");
    assert.match(
      decodeDataUri(attr(html, "link", "href") ?? "").body,
      /url\("data:image\/png;base64,/,
    );
  });

  it("クエリは捨て、フラグメントは残す", () => {
    write("icons.svg", "<svg/>");
    write("a.png", "A");
    const { html } = embed(page('<img src="a.png?v=2"><svg><image href="icons.svg#home"/></svg>'));
    assert.equal(decodeDataUri(attr(html, "img", "src") ?? "").body, "A");
    assert.match(attr(html, "image", "href") ?? "", /^data:image\/svg\+xml;base64,.*#home$/);
  });

  it("% エンコードされたファイル名を読める", () => {
    write("my image.png", "SP");
    const { html } = embed(page('<img src="my%20image.png">'));
    assert.equal(decodeDataUri(attr(html, "img", "src") ?? "").body, "SP");
  });

  it("書き換えない部分は元のまま残す", () => {
    const body =
      '<p class="x">日本語 &amp; <b>太字</b></p><script>const s = "src=\\"none.png\\"";</script>';
    const source = page(body);
    const { html } = embed(source);
    assert.ok(html.includes(body));
  });

  it("前に改行 CRLF や絵文字（サロゲートペア）があっても、書き換える位置がずれない", () => {
    write("a.png", "A");
    const before = '<p title="😀😀">日本語\r\n😀</p>\r\n';
    const after = '<p id="after">😀</p>';
    const { html } = embed(page(`${before}<img src="a.png" alt="x">${after}`));
    assert.ok(html.includes(before));
    assert.ok(html.includes(after));
    assert.equal(decodeDataUri(attr(html, "img", "src") ?? "").body, "A");
    assert.equal(attr(html, "img", "alt"), "x");
  });

  it("コメントの中や a の href の相対パスは、素材として扱わない", () => {
    const { html } = embed(
      page('<a href="other.html">x</a>', "<style>/* url(missing.png) */ p{}</style>"),
    );
    assert.equal(attr(html, "a", "href"), "other.html");
  });

  it("外部の URL は書き換えずに残し、警告を返す", () => {
    const { html, warnings } = embed(page('<img src="https://example.com/a.png">'));
    assert.equal(attr(html, "img", "src"), "https://example.com/a.png");
    assert.equal(warnings.length, 1);
  });

  it("data URI とフラグメントだけの参照は、そのまま残し警告もしない", () => {
    const { html, warnings } = embed(
      page('<img src="data:image/png;base64,AA=="><svg><use href="#a"/></svg>'),
    );
    assert.equal(attr(html, "img", "src"), "data:image/png;base64,AA==");
    assert.equal(attr(html, "use", "href"), "#a");
    assert.equal(warnings.length, 0);
  });
});

describe("embedPage: 拒否する入力", () => {
  it("見つからない素材はエラー", () => {
    assert.throws(() => embed(page('<img src="missing.png">')));
  });

  it("roots の外の素材はエラー", () => {
    write("secret.png", "S", base);
    assert.throws(() => embed(page('<img src="../secret.png">')));
  });

  it("roots の外を指すシンボリックリンクはエラー", () => {
    write("secret.png", "S", base);
    symlinkSync(join(base, "secret.png"), join(root, "link.png"));
    assert.throws(() => embed(page('<img src="link.png">')));
  });

  it("存在しない roots はエラー", () => {
    assert.throws(() => embedPage(page("<p>x</p>"), [join(base, "missing")]));
  });

  it("roots の外のページはエラー", () => {
    const outside = write("index.html", "<p>x</p>", base);
    assert.throws(() => embedPage(outside, [root]));
  });

  it("許可していない拡張子はエラー", () => {
    write("private.pem", "KEY");
    assert.throws(() => embed(page('<img src="private.pem">')));
  });

  it("<use> から別ファイルの SVG を参照するとエラー（ブラウザが data: を描画しない）", () => {
    write("icons.svg", "<svg/>");
    assert.throws(() => embed(page('<svg><use href="icons.svg#home"/></svg>')));
  });

  it("/ で始まるパスはエラー", () => {
    assert.throws(() => embed(page('<img src="/a.png">')));
  });

  it("循環する @import はエラー", () => {
    write("a.css", '@import "b.css";');
    write("b.css", '@import "a.css";');
    assert.throws(() => embed(page("", '<link rel="stylesheet" href="a.css">')));
  });

  it("素材の上限ちょうどは通り、1 バイト超えるとエラー", () => {
    write("a.png", Buffer.alloc(100));
    const source = page('<img src="a.png">');
    assert.doesNotThrow(() => embed(source, { maxAssetBytes: 100, maxPageBytes: 10_000 }));
    assert.throws(() => embed(source, { maxAssetBytes: 99, maxPageBytes: 10_000 }));
  });

  it("埋め込んだ後のページが上限を超えるとエラー", () => {
    write("a.png", Buffer.alloc(1000));
    assert.throws(() =>
      embed(page('<img src="a.png">'), { maxAssetBytes: 10_000, maxPageBytes: 1000 }),
    );
  });
});

describe("classifyReference", () => {
  for (const value of ["", "  ", "#top", "data:text/plain,a"]) {
    it(`"${value}" はそのまま残す`, () => {
      assert.equal(classifyReference(value).kind, "keep");
    });
  }
  for (const value of ["https://a.example/x.png", "//a.example/x.png", "mailto:a@example.com"]) {
    it(`${value} は外部`, () => {
      assert.equal(classifyReference(value).kind, "external");
    });
  }
  it("壊れた % エンコードはエラー", () => {
    assert.throws(() => classifyReference("a%E0.png"));
  });
});

describe("parseSrcset", () => {
  it("data URI の中のカンマで候補を分けない", () => {
    assert.deepEqual(parseSrcset("data:image/png;base64,AAAA 1x, b.png 2x"), [
      { url: "data:image/png;base64,AAAA", descriptors: "1x" },
      { url: "b.png", descriptors: "2x" },
    ]);
  });
  it("記述子のない候補と、末尾のカンマを扱える", () => {
    assert.deepEqual(parseSrcset("a.png, b.png 2x,"), [
      { url: "a.png", descriptors: "" },
      { url: "b.png", descriptors: "2x" },
    ]);
  });
});
