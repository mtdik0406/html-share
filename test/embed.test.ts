import assert from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

/** 書き方（url("…")・@import url(…) など）に依らず、文字列に含まれる data URI を前から順に取り出す。 */
function dataUrisIn(text: string): string[] {
  return [...text.matchAll(/data:[^"')\s]+/g)].map((m) => m[0]);
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
    assert.deepEqual(decodeDataUri(dataUrisIn(css.body)[0] ?? ""), {
      mime: "image/png",
      body: "BG",
    });
  });

  it("CSS の @import を中まで埋め込む", () => {
    write("b.css", ".b { color: red }");
    write("a.css", '@import "b.css";');
    const { html } = embed(page("", '<link rel="stylesheet" href="a.css">'));
    const outer = decodeDataUri(attr(html, "link", "href") ?? "").body;
    assert.equal(decodeDataUri(dataUrisIn(outer)[0] ?? "").body, ".b { color: red }");
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

  // README の「制約」に並べた埋め込み対象。表から 1 行消えると、配信先でその素材が 403 になる。
  for (const [label, markup, tag, name] of [
    ["img の src", '<img src="a.png">', "img", "src"],
    ["picture の source の src", '<video><source src="a.mp4"></video>', "source", "src"],
    ["audio の src", '<audio src="a.mp3"></audio>', "audio", "src"],
    ["video の src", '<video src="a.mp4"></video>', "video", "src"],
    ["video の poster", '<video poster="a.png"></video>', "video", "poster"],
    ["track の src", '<video><track src="a.vtt"></video>', "track", "src"],
    ["input type=image の src", '<input type="image" src="a.png" alt="x">', "input", "src"],
    ["SVG の image の href", '<svg><image href="a.svg"/></svg>', "image", "href"],
    ["SVG の image の xlink:href", '<svg><image xlink:href="a.svg"/></svg>', "image", "href"],
    ["link rel=icon の href", '<link rel="icon" href="a.png">', "link", "href"],
    [
      "link rel=apple-touch-icon の href",
      '<link rel="apple-touch-icon" href="a.png">',
      "link",
      "href",
    ],
    ["大文字や複数の値の rel", '<link rel="Shortcut ICON" href="a.png">', "link", "href"],
  ] as const) {
    it(`${label} を埋め込む`, () => {
      for (const file of ["a.png", "a.mp4", "a.mp3", "a.vtt", "a.svg"]) write(file, "X");
      const { html } = embed(page(markup));
      assert.equal(decodeDataUri(attr(html, tag, name) ?? "").body, "X");
    });
  }

  it("埋め込んだ手元のファイルの実体のパスを、重複なく返す", () => {
    write("a.png", "A");
    write("a.css", "p { background: url(a.png) }");
    const result = embedPage(
      page('<img src="a.png"><img src="a.png">', '<link rel="stylesheet" href="a.css">'),
      [root],
    );
    assert.deepEqual(
      [...result.assets].sort(),
      [join(realpathSync(root), "a.css"), join(realpathSync(root), "a.png")].sort(),
    );
  });

  it("<template> の中の素材も埋め込む", () => {
    write("a.png", "T");
    const { html } = embed(page('<template><img src="a.png"></template>'));
    assert.equal(decodeDataUri(dataUrisIn(html)[0] ?? "").body, "T");
  });

  it("拡張子の大文字・小文字は区別しない", () => {
    write("A.PNG", "U");
    const { html } = embed(page('<img src="A.PNG">'));
    assert.deepEqual(decodeDataUri(attr(html, "img", "src") ?? ""), {
      mime: "image/png",
      body: "U",
    });
  });

  it("2 つの CSS が同じ CSS を @import しても、循環とみなさない", () => {
    write("base.css", ".base{}");
    write("a.css", '@import "base.css";');
    write("b.css", '@import "base.css";');
    assert.doesNotThrow(() =>
      embed(page("", '<link rel="stylesheet" href="a.css"><link rel="stylesheet" href="b.css">')),
    );
  });

  it('フラグメントの & と " は、属性の値として正しく残る', () => {
    write("a.svg", "<svg/>");
    const { html } = embed(page('<svg><image href="a.svg#x&quot;y&amp;z"/></svg>'));
    assert.ok(attr(html, "image", "href")?.endsWith('#x"y&z'));
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

  for (const [label, markup] of [
    ["a のリンク先", '<a href="other.html">x</a>'],
    ["link rel=preload", '<link rel="preload" href="f.woff2" as="font">'],
    ["/ で始まるリンク先（エラーにはしない）", '<a href="/top">x</a>'],
  ] as const) {
    it(`埋め込まない属性の相対パス（${label}）は警告する`, () => {
      assert.equal(embed(page(markup)).warnings.length, 1);
    });
  }

  it("埋め込まない属性でも、フラグメントだけの参照と外部の URL は警告しない", () => {
    const { warnings } = embed(page('<a href="#top">t</a><a href="https://example.com/">e</a>'));
    assert.equal(warnings.length, 0);
  });

  it("CSS の文字列の中の url( は素材として扱わない", () => {
    const css = '.x::after { content: "see url(foo)" }';
    const { html, warnings } = embed(page("", `<style>${css}</style>`));
    assert.ok(html.includes(css));
    assert.equal(warnings.length, 0);
  });

  it("読み取れない url( は残して警告する", () => {
    const { warnings } = embed(page("", "<style>p { background: url(a\\ b.png) }</style>"));
    assert.equal(warnings.length, 1);
  });

  it('フラグメントの " は、CSS の文字列が閉じないようにエスケープする', () => {
    write("a.svg", "<svg/>");
    const { html } = embed(page("", `<style>p { background: url('a.svg#a"b') }</style>`));
    assert.match(html, /#a\\"b"\)/);
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

  it("名前が roots で始まる隣のディレクトリはエラー（root と root2 を取り違えない）", () => {
    write("x.png", "S", join(base, "root2"));
    assert.throws(() => embed(page('<img src="../root2/x.png">')));
  });

  it("CSS ファイルの中から roots の外を参照するとエラー", () => {
    write("secret.png", "S", base);
    write("a.css", "p { background: url(../secret.png) }");
    assert.throws(() => embed(page("", '<link rel="stylesheet" href="a.css">')));
  });

  for (const [label, relPath] of [
    [". で始まるディレクトリの中の素材", ".config/app/settings.js"],
    [". で始まるファイル", ".secret.png"],
    ["node_modules の中の素材", "node_modules/lib/index.js"],
  ] as const) {
    it(`${label}はエラー（AI が書いた参照で、手元の設定や依存を公開しない）`, () => {
      write(relPath, "S");
      assert.throws(() => embed(page(`<script src="${relPath}"></script>`)));
    });
  }

  it(". で始まるディレクトリの中のページはエラー", () => {
    const source = write(".drafts/index.html", "<p>x</p>");
    assert.throws(() => embed(source));
  });

  it("roots の外を指すシンボリックリンクはエラー", () => {
    write("secret.png", "S", base);
    symlinkSync(join(base, "secret.png"), join(root, "link.png"));
    assert.throws(() => embed(page('<img src="link.png">')));
  });

  it("roots の外のファイルへのハードリンクはエラー（実体のパスでは見分けられない）", () => {
    write("secret.png", "S", base);
    linkSync(join(base, "secret.png"), join(root, "link.png"));
    assert.throws(() => embed(page('<img src="link.png">')));
  });

  it("roots の 1 つが存在しなければ、ほかの roots が正しくてもエラー", () => {
    assert.throws(() => embedPage(page("<p>x</p>"), [root, join(base, "missing")]));
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

  it("<base href> はエラー（配信時は CSP で無効になり、参照先が変わる）", () => {
    write("a.png", "A");
    assert.throws(() => embed(page('<img src="a.png">', '<base href="static/">')));
  });

  it("位置のわからない属性（後から現れた 2 つ目の <body>）の素材はエラー", () => {
    write("bg.png", "BG");
    const source = write(
      "index.html",
      '<!doctype html><p>x</p><body style="background:url(bg.png)"><p>y</p></body>',
    );
    assert.throws(() => embed(source));
  });

  it("/ で始まるパスは、roots の中の実在するファイルを指していてもエラー", () => {
    const file = write("a.png", "A");
    assert.throws(() => embed(page(`<img src="${file}">`)));
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

  it("既定の素材の上限は 10 MiB", () => {
    write("big.png", Buffer.alloc(10 * 1024 * 1024 + 1));
    assert.throws(() => embedPage(page('<img src="big.png">'), [root]));
  });

  it("埋め込んだ後のページは、上限ちょうどなら通る", () => {
    write("a.png", Buffer.alloc(100));
    const source = page('<img src="a.png">');
    const size = embed(source).html.length;
    assert.doesNotThrow(() => embed(source, { maxAssetBytes: 10_000, maxPageBytes: size }));
    assert.throws(() => embed(source, { maxAssetBytes: 10_000, maxPageBytes: size - 1 }));
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
