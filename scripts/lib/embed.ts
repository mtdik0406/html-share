import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { type DefaultTreeAdapterTypes, parse } from "parse5";

type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type Element = DefaultTreeAdapterTypes.Element;

/**
 * 埋め込んでよい素材の種類。ここに無い拡張子はエラーにする。
 * 秘密鍵や設定ファイルを、相対パスの書き間違いでページに入れて公開しないため。
 */
const MIME_TYPES: Readonly<Record<string, string>> = {
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
  /** 書き換えずに残した外部の URL。CSP で読み込めないので、ページが崩れる手がかりになる。 */
  warnings: string[];
}

/**
 * - url: 素材の URL を 1 つ持つ
 * - srcset: 「URL 記述子」の候補を並べる
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
  /** 実体のパス → data URI。同じ素材を何度参照されても、読み込みと変換は 1 回で済ませる。 */
  cache: Map<string, string>;
}

/**
 * HTML が相対パスで読む素材を data URI にして、1 ファイルで完結させる。
 * 署名付き URL は URL ごとに効くので、別のファイルとして置いた素材は 403 になるため。
 */
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
  const ctx: Context = { roots: realRoots, limits, warnings: [], cache: new Map() };

  const { file: source } = resolveInsideRoots(sourcePath, ctx);
  const html = readFileSync(source, "utf8");
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
  return { html: output, warnings: ctx.warnings };
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
  const location = element.sourceCodeLocation;
  // パーサーが補った要素（書かれていない <head> など）は位置を持たず、書き換えるものもない。
  if (!location) return;

  for (const attr of element.attrs) {
    const name = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
    const attrLocation = location.attrs?.[name];
    if (!attrLocation) continue;

    const rewritten = rewriteAttribute(element, name, attr.value, baseDir, ctx);
    if (rewritten === attr.value) continue;
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

/** 書き換えないときは value をそのまま返す。 */
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
      if (!rels.some((rel) => EMBEDDED_LINK_RELS.has(rel))) return value;
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
      return value;
  }
}

type Reference =
  | { kind: "keep" }
  | { kind: "external"; url: string }
  | { kind: "local"; path: string; fragment: string };

/** 素材の参照を、そのまま残すもの・外部の URL・手元のファイルに分ける。 */
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

/** CSS のコメントは素通しする。コメントアウトした url() を見つからない素材として扱わないため。 */
const CSS_TOKEN =
  /\/\*[\s\S]*?\*\/|@import\s+(?:"([^"]*)"|'([^']*)')|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi;

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
  return css.replace(CSS_TOKEN, (match, importDq, importSq, urlDq, urlSq, urlBare) => {
    if (match.startsWith("/*")) return match;
    const isImport = importDq !== undefined || importSq !== undefined;
    const raw: string = importDq ?? importSq ?? urlDq ?? urlSq ?? urlBare ?? "";
    const uri = embedReference(raw, baseDir, ctx, stack);
    if (uri === undefined) return match;
    return isImport ? `@import url("${uri}")` : `url("${uri}")`;
  });
}

function dataUriFor(candidate: string, ctx: Context, stack: readonly string[]): string {
  const { file, size } = resolveInsideRoots(candidate, ctx);
  // 循環の判定はキャッシュより先に行う。キャッシュに入るのは、最後まで埋め込めた CSS だけ。
  if (stack.includes(file)) throw new Error(`CSS の @import が循環しています: ${candidate}`);
  const cached = ctx.cache.get(file);
  if (cached !== undefined) return cached;

  const mime = MIME_TYPES[extname(file).toLowerCase()];
  if (!mime) {
    throw new Error(`埋め込めない種類のファイルです（拡張子で判定）: ${candidate}`);
  }
  if (size > ctx.limits.maxAssetBytes) {
    throw new Error(
      `素材が上限 ${ctx.limits.maxAssetBytes} バイトを超えます（${size} バイト）: ${candidate}`,
    );
  }

  let uri: string;
  if (mime === "text/css") {
    const css = rewriteCss(readFileSync(file, "utf8"), dirname(file), ctx, [...stack, file]);
    uri = `data:text/css;charset=utf-8;base64,${Buffer.from(css, "utf8").toString("base64")}`;
  } else {
    // 中の import は解決しないので、JS は 1 ファイルにまとめてある前提（README の「制約」）。
    uri = `data:${mime};base64,${readFileSync(file).toString("base64")}`;
  }
  ctx.cache.set(file, uri);
  return uri;
}

/**
 * シンボリックリンクをたどった先で判定する。リンクでルートの外（~/.ssh など）を指されても、
 * 中身をページに入れて公開しないため。
 */
function resolveInsideRoots(candidate: string, ctx: Context): { file: string; size: number } {
  let file: string;
  try {
    file = realpathSync(candidate);
  } catch {
    throw new Error(`ファイルが見つかりません: ${candidate}`);
  }
  if (!ctx.roots.some((root) => isInside(file, root))) {
    throw new Error(`設定の roots の外にあるファイルは使えません: ${candidate}`);
  }
  const stat = statSync(file);
  if (!stat.isFile()) throw new Error(`ファイルではありません: ${candidate}`);
  return { file, size: stat.size };
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
