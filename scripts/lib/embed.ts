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

export const DEFAULT_LIMITS = {
  maxAssetBytes: 10 * 1024 * 1024,
  /** data URI は base64 で約 1.33 倍になるので、素材の上限より大きく取る。 */
  maxPageBytes: 25 * 1024 * 1024,
} as const;

export interface EmbedLimits {
  maxAssetBytes: number;
  maxPageBytes: number;
}

export interface EmbedResult {
  html: Buffer;
  /** 書き換えずに残した外部の URL。CSP で読み込めないので、ページが崩れる手がかりになる。 */
  warnings: string[];
}

/** 要素ごとに、素材の URL を 1 つだけ持つ属性。<a href> はページ間の移動なので含めない。 */
const URL_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  img: ["src"],
  source: ["src"],
  script: ["src"],
  audio: ["src"],
  video: ["src", "poster"],
  track: ["src"],
  input: ["src"],
  image: ["href", "xlink:href"],
};
const SRCSET_ELEMENTS = new Set(["img", "source"]);
const EMBEDDED_LINK_RELS = new Set(["stylesheet", "icon", "apple-touch-icon"]);

interface Edit {
  start: number;
  end: number;
  text: string;
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
  const realRoots = roots.map((root) => {
    try {
      return realpathSync(root);
    } catch {
      throw new Error(`roots のディレクトリが見つかりません: ${root}`);
    }
  });
  const ctx: Context = { roots: realRoots, limits, warnings: [] };

  const source = resolveInsideRoots(sourcePath, ctx);
  const html = readFileSync(source, "utf8");
  const baseDir = dirname(source);

  const edits: Edit[] = [];
  const document = parse(html, { sourceCodeLocationInfo: true });
  walk(document, (element) => collectEdits(element, html, baseDir, ctx, edits));

  const output = Buffer.from(applyEdits(html, edits), "utf8");
  if (output.length > limits.maxPageBytes) {
    throw new Error(
      `埋め込んだ後のページが上限 ${limits.maxPageBytes} バイトを超えます（${output.length} バイト）: ${sourcePath}`,
    );
  }
  return { html: output, warnings: ctx.warnings };
}

interface Context {
  roots: string[];
  limits: EmbedLimits;
  warnings: string[];
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
    if (rewritten === undefined || rewritten === attr.value) continue;
    edits.push({
      start: attrLocation.startOffset,
      end: attrLocation.endOffset,
      text: `${name}="${escapeAttribute(rewritten)}"`,
    });
  }

  if (element.tagName === "style") {
    const text = element.childNodes[0];
    const textLocation = text?.sourceCodeLocation;
    if (textLocation) {
      // パーサーの値ではなく元の文字列を使う。<style> の中身は実体参照を解釈しないので両者は同じだが、
      // 書き換える範囲と中身の出どころを 1 つにそろえておく。
      const css = html.slice(textLocation.startOffset, textLocation.endOffset);
      const rewritten = rewriteCss(css, baseDir, ctx, []);
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
): string | undefined {
  const tag = element.tagName;
  if (name === "style") return rewriteCss(value, baseDir, ctx, []);
  if (name === "srcset" && SRCSET_ELEMENTS.has(tag)) return rewriteSrcset(value, baseDir, ctx);
  if (tag === "link" && name === "href") {
    const rels = (element.attrs.find((a) => a.name === "rel")?.value ?? "")
      .toLowerCase()
      .split(/\s+/);
    if (!rels.some((rel) => EMBEDDED_LINK_RELS.has(rel))) return undefined;
    return rewriteUrl(value, baseDir, ctx);
  }
  if (tag === "use" && (name === "href" || name === "xlink:href")) {
    // Chrome は <use> の data: URL を描画しない。別ファイルのままでは署名がなく 403 になるので、止める。
    if (classifyReference(value).kind === "local") {
      throw new Error(
        `<use> は別ファイルの SVG を参照できません。SVG をページに直接書いてください: ${value}`,
      );
    }
    return undefined;
  }
  if (URL_ATTRIBUTES[tag]?.includes(name)) return rewriteUrl(value, baseDir, ctx);
  return undefined;
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

function rewriteUrl(value: string, baseDir: string, ctx: Context): string {
  const ref = classifyReference(value);
  if (ref.kind === "keep") return value;
  if (ref.kind === "external") {
    ctx.warnings.push(`外部の URL は CSP で読み込めません: ${ref.url}`);
    return value;
  }
  return dataUriFor(resolve(baseDir, ref.path), ctx, []) + ref.fragment;
}

function rewriteSrcset(value: string, baseDir: string, ctx: Context): string {
  return parseSrcset(value)
    .map(({ url, descriptors }) =>
      [rewriteUrl(url, baseDir, ctx), descriptors].filter((s) => s !== "").join(" "),
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
function rewriteCss(css: string, baseDir: string, ctx: Context, stack: string[]): string {
  return css.replace(CSS_TOKEN, (match, importDq, importSq, urlDq, urlSq, urlBare) => {
    if (match.startsWith("/*")) return match;
    const isImport = importDq !== undefined || importSq !== undefined;
    const raw: string = importDq ?? importSq ?? urlDq ?? urlSq ?? urlBare ?? "";
    const ref = classifyReference(raw);
    if (ref.kind === "keep") return match;
    if (ref.kind === "external") {
      ctx.warnings.push(`外部の URL は CSP で読み込めません: ${ref.url}`);
      return match;
    }
    const uri = dataUriFor(resolve(baseDir, ref.path), ctx, stack) + ref.fragment;
    return isImport ? `@import url("${uri}")` : `url("${uri}")`;
  });
}

function dataUriFor(candidate: string, ctx: Context, stack: string[]): string {
  const file = resolveInsideRoots(candidate, ctx);
  const mime = MIME_TYPES[extname(file).toLowerCase()];
  if (!mime) {
    throw new Error(`埋め込めない種類のファイルです（拡張子で判定）: ${candidate}`);
  }
  const size = statSync(file).size;
  if (size > ctx.limits.maxAssetBytes) {
    throw new Error(
      `素材が上限 ${ctx.limits.maxAssetBytes} バイトを超えます（${size} バイト）: ${candidate}`,
    );
  }

  if (mime === "text/css") {
    if (stack.includes(file)) throw new Error(`CSS の @import が循環しています: ${candidate}`);
    const css = rewriteCss(readFileSync(file, "utf8"), dirname(file), ctx, [...stack, file]);
    return `data:text/css;charset=utf-8;base64,${Buffer.from(css, "utf8").toString("base64")}`;
  }
  // 中の import は解決しないので、JS は 1 ファイルにまとめてある前提（README の「制約」）。
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
}

/**
 * シンボリックリンクをたどった先で判定する。リンクでルートの外（~/.ssh など）を指されても、
 * 中身をページに入れて公開しないため。
 */
function resolveInsideRoots(candidate: string, ctx: Context): string {
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    throw new Error(`ファイルが見つかりません: ${candidate}`);
  }
  if (!ctx.roots.some((root) => isInside(real, root))) {
    throw new Error(`設定の roots の外にあるファイルは使えません: ${candidate}`);
  }
  if (!statSync(real).isFile()) throw new Error(`ファイルではありません: ${candidate}`);
  return real;
}

function isInside(file: string, root: string): boolean {
  const rel = relative(root, file);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function applyEdits(html: string, edits: Edit[]): string {
  let result = html;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}
