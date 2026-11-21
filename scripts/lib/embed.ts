import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { type DefaultTreeAdapterTypes, parse } from "parse5";

type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type Element = DefaultTreeAdapterTypes.Element;

/**
 * 埋め込んでよい素材の種類。ここに無い拡張子はエラーにする。
 * 秘密鍵や設定ファイルを、相対パスの書き間違いでページに入れて公開しないため。
 */
export const MIME_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".vtt": "text/vtt",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
};

export interface EmbedLimits {
  maxAssetBytes: number;
  maxPageBytes: number;
}

const DEFAULT_LIMITS: EmbedLimits = {
  maxAssetBytes: 10 * 1024 * 1024,
  /** data URI は base64 で約 1.33 倍になるので、素材の上限より大きく取る。 */
  maxPageBytes: 25 * 1024 * 1024,
};

export interface EmbedResult {
  html: Buffer;
  /** 埋め込んだ手元のファイルの実体のパス。意図しないファイルを公開していないか、利用者が確かめるため。 */
  assets: string[];
  /** 書き換えずに残した外部の URL。CSP で読み込めないので、ページが崩れる手がかりになる。 */
  warnings: string[];
}

/**
 * - link: rel が EMBEDDED_LINK_RELS のときだけ url と同じ。ほかの rel（canonical など）は素材ではない
 * - reject-local: Chrome は <use> の data: URL を描画しない。別ファイルのままでは署名がなく 403 になるので、止める
 *
 * <a href> はページ間の移動で素材ではないので含めない。style 属性はどの要素でも CSS として扱う。
 */
type Handling = "url" | "srcset" | "link" | "reject-local";
const ATTRIBUTE_HANDLING: Readonly<Record<string, Readonly<Record<string, Handling>>>> = {
  img: { src: "url", srcset: "srcset" },
  source: { src: "url", srcset: "srcset" },
  script: { src: "url" },
  audio: { src: "url" },
  video: { src: "url", poster: "url" },
  track: { src: "url" },
  input: { src: "url" },
  image: { href: "url", "xlink:href": "url" },
  link: { href: "link" },
  use: { href: "reject-local", "xlink:href": "reject-local" },
};
const EMBEDDED_LINK_RELS = new Set(["stylesheet", "icon", "apple-touch-icon"]);

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface Context {
  roots: string[];
  limits: EmbedLimits;
  warnings: string[];
  assets: Set<string>;
  /** 実体のパス → data URI。同じ素材を何度参照されても、読み込みと変換は 1 回で済ませる。 */
  cache: Map<string, string>;
}

/** 署名付き URL は URL ごとに効くので、別のファイルとして置いた素材は 403 になる。だから 1 ファイルにまとめる。 */
export function embedPage(
  sourcePath: string,
  roots: readonly string[],
  limits: EmbedLimits = DEFAULT_LIMITS,
): EmbedResult {
  try {
    return embedPageUnlabeled(sourcePath, roots, limits);
  } catch (err) {
    // 同期は複数のページを続けて埋め込むので、どのページで失敗したかをここで 1 度だけ添える。
    throw new Error(`${sourcePath}: ${(err as Error).message}`, { cause: err });
  }
}

function embedPageUnlabeled(
  sourcePath: string,
  roots: readonly string[],
  limits: EmbedLimits,
): EmbedResult {
  const realRoots = roots.map((root) => {
    try {
      return realpathSync(root);
    } catch {
      throw new Error(`roots のディレクトリが見つかりません: ${root}`);
    }
  });
  const ctx: Context = {
    roots: realRoots,
    limits,
    warnings: [],
    assets: new Set(),
    cache: new Map(),
  };

  const source = resolveInsideRoots(sourcePath, ctx);
  const html = readVerified(source, sourcePath, limits.maxPageBytes).toString("utf8");
  const baseDir = dirname(source);

  const edits: Edit[] = [];
  const document = parse(html, { sourceCodeLocationInfo: true });
  walk(document, (element) => collectEdits(element, html, baseDir, ctx, edits));

  const output = Buffer.from(applyEdits(html, edits), "utf8");
  if (output.length > limits.maxPageBytes) {
    throw new Error(
      `埋め込んだ後のページが上限 ${limits.maxPageBytes} バイトを超えます（${output.length} バイト）`,
    );
  }
  return { html: output, assets: [...ctx.assets], warnings: ctx.warnings };
}

function walk(node: ParentNode, visit: (element: Element) => void): void {
  for (const child of node.childNodes) {
    if (!("tagName" in child)) continue;
    visit(child);
    walk(child, visit);
    // <template> の中身は childNodes ではなく content に入る。
    if ("content" in child) walk(child.content as ParentNode, visit);
  }
}

function collectEdits(
  element: Element,
  html: string,
  baseDir: string,
  ctx: Context,
  edits: Edit[],
): void {
  if (element.tagName === "base" && element.attrs.some((a) => a.name === "href")) {
    // 配信時は CSP の base-uri 'none' で <base> が無効になり、手元と配信先で参照先が変わる。
    throw new Error("<base href> は使えません。素材はページからの相対パスで書いてください");
  }

  // パーサーが補った要素や、後から現れた <body> の属性を前の要素に合わせたものは、元の位置を持たない。
  const location = element.sourceCodeLocation;
  for (const attr of element.attrs) {
    const name = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
    const rewritten = rewriteAttribute(element, name, attr.value, baseDir, ctx);
    if (rewritten === attr.value) continue;

    const attrLocation = location?.attrs?.[name];
    if (!attrLocation) {
      // 書き換えられないまま公開すると、署名のない素材の読み込みが 403 になる。
      throw new Error(
        `<${element.tagName} ${name}> の位置がわからず埋め込めません。タグの重複（2 つ目の <body> など）を直してください`,
      );
    }
    edits.push({
      start: attrLocation.startOffset,
      end: attrLocation.endOffset,
      text: `${name}="${escapeAttribute(rewritten)}"`,
    });
  }

  if (element.tagName === "style") {
    const textLocation = element.childNodes[0]?.sourceCodeLocation;
    if (textLocation) {
      // パーサーの値ではなく元の文字列を使う。<style> の中身は実体参照を解釈しないので両者は同じだが、
      // 書き換える範囲と中身の出どころを 1 つにそろえておく。
      const css = html.slice(textLocation.startOffset, textLocation.endOffset);
      const rewritten = rewriteCss(css, baseDir, ctx);
      if (rewritten !== css) {
        edits.push({
          start: textLocation.startOffset,
          end: textLocation.endOffset,
          text: rewritten,
        });
      }
    }
  }
}

function rewriteAttribute(
  element: Element,
  name: string,
  value: string,
  baseDir: string,
  ctx: Context,
): string {
  if (name === "style") return rewriteCss(value, baseDir, ctx);
  switch (ATTRIBUTE_HANDLING[element.tagName]?.[name]) {
    case "url":
      return embedReference(value, baseDir, ctx) ?? value;
    case "srcset":
      return rewriteSrcset(value, baseDir, ctx);
    case "link": {
      const rels = (element.attrs.find((a) => a.name === "rel")?.value ?? "")
        .toLowerCase()
        .split(/\s+/);
      if (!rels.some((rel) => EMBEDDED_LINK_RELS.has(rel))) {
        warnIfLocal(element, name, value, ctx);
        return value;
      }
      return embedReference(value, baseDir, ctx) ?? value;
    }
    case "reject-local":
      if (classifyReference(value).kind === "local") {
        throw new Error(
          `<use> は別ファイルの SVG を参照できません。SVG をページに直接書いてください: ${value}`,
        );
      }
      return value;
    case undefined:
      if (REFERENCE_ATTRIBUTES.has(name)) warnIfLocal(element, name, value, ctx);
      return value;
  }
}

/** 埋め込まない属性のうち、ファイルを指しうるもの。 */
const REFERENCE_ATTRIBUTES = new Set(["src", "href", "xlink:href", "data", "poster", "srcset"]);

/**
 * 埋め込まない属性の相対パスは、配信先で署名がなく 403 になる。<a href> のリンク先もこれに当たる。
 * 止めはしない（リンク切れでもページは読める）が、気づけるように警告する。
 */
function warnIfLocal(element: Element, name: string, value: string, ctx: Context): void {
  let local: boolean;
  try {
    local = classifyReference(value).kind === "local";
  } catch {
    // / で始まるパスなども、配信先では同じく 403 になる。
    local = true;
  }
  if (local) {
    ctx.warnings.push(
      `<${element.tagName} ${name}> の相対パスは埋め込まず、配信先では開けません: ${value}`,
    );
  }
}

type Reference =
  | { kind: "keep" }
  | { kind: "external"; url: string }
  | { kind: "local"; path: string; fragment: string };

export function classifyReference(raw: string): Reference {
  const value = raw.trim();
  if (value === "" || value.startsWith("#")) return { kind: "keep" };
  if (/^data:/i.test(value)) return { kind: "keep" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) {
    return { kind: "external", url: value };
  }
  if (value.startsWith("/")) {
    // 配信先ではパスの起点がページの置き場所と異なり、手元のどのファイルを指すかも決まらない。
    throw new Error(`/ で始まるパスは埋め込めません。ページからの相対パスにしてください: ${value}`);
  }
  // クエリはキャッシュよけ（?v=2 など）で付くことが多く、手元のファイルを選ぶ役に立たないので捨てる。
  // フラグメントは SVG の #id など意味を持つので残す。
  const hashIndex = value.indexOf("#");
  const fragment = hashIndex === -1 ? "" : value.slice(hashIndex);
  const beforeHash = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const pathPart = beforeHash.split("?", 1)[0] ?? "";
  let path: string;
  try {
    path = decodeURIComponent(pathPart);
  } catch {
    throw new Error(`パスの % エンコードが壊れています: ${value}`);
  }
  if (path === "") throw new Error(`パスがありません: ${value}`);
  return { kind: "local", path, fragment };
}

/** 手元のファイルなら data URI を返す。残す参照と外部の URL（警告を積む）は undefined。 */
function embedReference(
  raw: string,
  baseDir: string,
  ctx: Context,
  stack: readonly string[] = [],
): string | undefined {
  const ref = classifyReference(raw);
  if (ref.kind === "keep") return undefined;
  if (ref.kind === "external") {
    ctx.warnings.push(`外部の URL は CSP で読み込めません: ${ref.url}`);
    return undefined;
  }
  return dataUriFor(resolve(baseDir, ref.path), ctx, stack) + ref.fragment;
}

function rewriteSrcset(value: string, baseDir: string, ctx: Context): string {
  return parseSrcset(value)
    .map(({ url, descriptors }) =>
      [embedReference(url, baseDir, ctx) ?? url, descriptors].filter((s) => s !== "").join(" "),
    )
    .join(", ");
}

/**
 * HTML の仕様の srcset の読み方に合わせる。URL は空白までで、末尾のカンマは候補の区切り。
 * 単純にカンマで分けると、data URI（data:image/png;base64,...）の中のカンマで壊れる。
 */
export function parseSrcset(value: string): { url: string; descriptors: string }[] {
  const candidates: { url: string; descriptors: string }[] = [];
  const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);
  let i = 0;
  while (i < value.length) {
    while (i < value.length && (isSpace(value[i]) || value[i] === ",")) i++;
    if (i >= value.length) break;

    const urlStart = i;
    while (i < value.length && !isSpace(value[i])) i++;
    let url = value.slice(urlStart, i);
    let descriptors = "";
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      const descriptorStart = i;
      while (i < value.length && value[i] !== ",") i++;
      descriptors = value.slice(descriptorStart, i).trim();
    }
    candidates.push({ url, descriptors });
  }
  return candidates;
}

/**
 * 前から順に、コメント・文字列の @import・url()・ただの文字列・読み取れなかった url( を拾う。
 * ただの文字列（content: "url(x)" など）は素通しする。中の url( を素材と取り違えないため。
 */
const CSS_TOKEN =
  /\/\*[\s\S]*?\*\/|@import\s+(?:"([^"]*)"|'([^']*)')|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|url\(/gi;

/**
 * CSS の中の相対パスは、その CSS ファイルを起点に解決する。
 * data URI にした CSS からは元の置き場所がわからず、相対パスを解決できなくなるため、先に埋め込む。
 */
function rewriteCss(
  css: string,
  baseDir: string,
  ctx: Context,
  stack: readonly string[] = [],
): string {
  return css.replace(
    CSS_TOKEN,
    (
      match: string,
      importDq?: string,
      importSq?: string,
      urlDq?: string,
      urlSq?: string,
      urlBare?: string,
      offset = 0,
    ) => {
      if (match.startsWith("/*") || match.startsWith('"') || match.startsWith("'")) return match;
      if (/^url\($/i.test(match)) {
        // エスケープを含む url(a\ b.png) など。黙って残すと、配信先で 403 になる。
        ctx.warnings.push(
          `CSS の url( を読み取れず、埋め込んでいません: ${css.slice(offset, offset + 60)}`,
        );
        return match;
      }
      const isImport = importDq !== undefined || importSq !== undefined;
      const raw: string = importDq ?? importSq ?? urlDq ?? urlSq ?? urlBare ?? "";
      const uri = embedReference(raw, baseDir, ctx, stack);
      if (uri === undefined) return match;
      // フラグメントは元の参照から写すので、" や \ を含むと CSS の文字列が閉じてしまう。
      const quoted = `"${uri.replace(/["\\]/g, "\\$&")}"`;
      return isImport ? `@import url(${quoted})` : `url(${quoted})`;
    },
  );
}

function dataUriFor(candidate: string, ctx: Context, stack: readonly string[]): string {
  const file = resolveInsideRoots(candidate, ctx);
  ctx.assets.add(file);
  // 循環の判定はキャッシュより先に行う。キャッシュに入るのは、最後まで埋め込めた CSS だけ。
  if (stack.includes(file)) throw new Error(`CSS の @import が循環しています: ${candidate}`);
  const cached = ctx.cache.get(file);
  if (cached !== undefined) return cached;

  const mime = MIME_TYPES[extname(file).toLowerCase()];
  if (!mime) {
    throw new Error(`埋め込めない種類のファイルです（拡張子で判定）: ${candidate}`);
  }
  const content = readVerified(file, candidate, ctx.limits.maxAssetBytes);

  let uri: string;
  if (mime === "text/css") {
    const css = rewriteCss(content.toString("utf8"), dirname(file), ctx, [...stack, file]);
    uri = `data:text/css;charset=utf-8;base64,${Buffer.from(css, "utf8").toString("base64")}`;
  } else {
    // 中の import は解決しないので、JS は 1 ファイルにまとめてある前提（README の「制約」）。
    uri = `data:${mime};base64,${content.toString("base64")}`;
  }
  ctx.cache.set(file, uri);
  return uri;
}

/**
 * シンボリックリンクをたどった先で判定する。リンクでルートの外（~/.ssh など）を指されても、
 * 中身をページに入れて公開しないため。
 */
function resolveInsideRoots(candidate: string, ctx: Context): string {
  let file: string;
  try {
    file = realpathSync(candidate);
  } catch {
    throw new Error(`ファイルが見つかりません: ${candidate}`);
  }
  const root = ctx.roots.find((r) => isInside(file, r));
  if (root === undefined) {
    throw new Error(`設定の roots の外にあるファイルは使えません: ${candidate}`);
  }
  // AI が書いた参照で、roots の中にある手元の設定（.git や .config）や依存を公開しないため。
  const hidden = relative(root, file)
    .split(sep)
    .find((segment) => segment.startsWith(".") || segment === "node_modules");
  if (hidden !== undefined) {
    throw new Error(`${hidden} の中のファイルは使えません: ${candidate}`);
  }
  return file;
}

/**
 * 確かめたファイルと読むファイルを同じにする。パスで確かめてからパスで読み直すと、その間に
 * 途中のディレクトリをシンボリックリンクに差し替えられ、roots の外を読まされうる。
 * 開いたものを確かめ、同じものから読む。roots に書き込める相手への完全な防御ではない（README の「制約」）。
 */
function readVerified(file: string, candidate: string, maxBytes: number): Buffer {
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error(`ファイルを開けません: ${candidate}`);
  }
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) throw new Error(`ファイルではありません: ${candidate}`);
    // ハードリンクは実体のパスが roots の中に見えるので、roots の外のファイルと見分けられない。
    if (opened.nlink > 1) throw new Error(`ハードリンクのファイルは使えません: ${candidate}`);
    if (opened.size > maxBytes) {
      throw new Error(`上限 ${maxBytes} バイトを超えます（${opened.size} バイト）: ${candidate}`);
    }
    const current = statSync(file);
    if (realpathSync(file) !== file || current.ino !== opened.ino || current.dev !== opened.dev) {
      throw new Error(`確かめている間にファイルが差し替えられました: ${candidate}`);
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function isInside(file: string, root: string): boolean {
  const rel = relative(root, file);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

/** 位置の昇順に一度だけたどる。後ろから 1 つずつ差し替えると、編集のたびにページ全体を写すため。 */
function applyEdits(html: string, edits: readonly Edit[]): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    parts.push(html.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  parts.push(html.slice(cursor));
  return parts.join("");
}
