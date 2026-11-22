import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertSlug } from "../../core/page.js";

interface PageEntry {
  slug: string;
  /** 絶対パス */
  source: string;
}

export interface SyncConfig {
  /** 絶対パス。ページと素材は、どれかの中にあるファイルだけを使える。 */
  roots: string[];
  pages: PageEntry[];
}

/** 知らないキーはエラーにする。綴りの誤り（"page" など）で設定が黙って無視されるのを防ぐため。 */
export function parseConfig(
  text: string,
  configDir: string,
  homeDir: string,
  /** roots にも、その親にもしてはいけないディレクトリ（ホームやこのリポジトリ）。 */
  protectedDirs: readonly string[] = [homeDir],
): SyncConfig {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`設定ファイルが JSON として読めません: ${(err as Error).message}`);
  }
  const root = asObject(data, "設定", ["roots", "pages"]);
  const toPath = (raw: string) => resolvePath(raw, configDir, homeDir);

  if (!Array.isArray(root.roots) || root.roots.length === 0) {
    throw new Error("roots にはディレクトリを 1 つ以上並べてください");
  }
  const roots = root.roots.map((r, i) => toPath(asString(r, `roots[${i}]`)));
  for (const r of roots) {
    // 埋め込みは roots の中ならどのファイルでも読むので、広すぎると鍵や設定まで公開できてしまう。
    const covered = protectedDirs.find((dir) => {
      const rel = relative(r, resolve(dir));
      return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
    });
    if (covered !== undefined) {
      throw new Error(
        `roots を ${r} にすると ${covered} を丸ごと含みます。公開するページの置き場所に絞ってください`,
      );
    }
  }

  if (!Array.isArray(root.pages)) throw new Error("pages は配列にしてください");
  const seen = new Set<string>();
  const pages = root.pages.map((p, i): PageEntry => {
    const page = asObject(p, `pages[${i}]`, ["slug", "source"]);
    const slug = asString(page.slug, `pages[${i}].slug`);
    assertSlug(slug);
    if (seen.has(slug)) throw new Error(`slug が重複しています: ${slug}`);
    seen.add(slug);
    return { slug, source: toPath(asString(page.source, `pages[${i}].source`)) };
  });

  return { roots, pages };
}

function resolvePath(raw: string, baseDir: string, homeDir: string): string {
  if (raw === "~" || raw.startsWith("~/")) return join(homeDir, raw.slice(1));
  return isAbsolute(raw) ? raw : resolve(baseDir, raw);
}

function asObject(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} はオブジェクトにしてください`);
  }
  const unknownKeys = Object.keys(value).filter((k) => !allowedKeys.includes(k));
  if (unknownKeys.length > 0) {
    throw new Error(`${label} に知らないキーがあります: ${unknownKeys.join(", ")}`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${label} は空でない文字列にしてください`);
  }
  return value;
}
