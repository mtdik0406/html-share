import { DAY_MS, MAX_DAYS } from "../../core/lifetime.js";

/** slug → 取り下げた時刻（ISO 8601） */
export type RetiredSlugs = Readonly<Record<string, string>>;

/**
 * 署名は URL と期限にだけ結び付くので、取り下げる前に配った URL は、最長でこの期間だけ有効なまま残る。
 * その間に同じ slug で別のページを置くと、古い URL の持ち主が新しいページを見られる。
 */
const REUSE_BLOCK_MS = MAX_DAYS * DAY_MS;

export function assertNoRecentReuse(
  slugs: readonly string[],
  retired: RetiredSlugs,
  now: Date,
): void {
  for (const slug of slugs) {
    const retiredAt = retired[slug];
    if (retiredAt === undefined) continue;
    const until = new Date(Date.parse(retiredAt) + REUSE_BLOCK_MS);
    if (now < until) {
      throw new Error(
        `slug ${slug} は ${retiredAt} に取り下げたので、${until.toISOString()} まで使えません。` +
          "取り下げる前に配った URL で、新しいページが見えてしまうためです。別の slug にしてください",
      );
    }
  }
}

export function recordRetired(
  retired: RetiredSlugs,
  slugs: readonly string[],
  now: Date,
): RetiredSlugs {
  const kept = Object.entries(retired).filter(
    ([, at]) => now.getTime() - Date.parse(at) < REUSE_BLOCK_MS,
  );
  return Object.fromEntries([...kept, ...slugs.map((slug) => [slug, now.toISOString()])]);
}

export function parseRetired(text: string): RetiredSlugs {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("取り下げた slug の記録が JSON として読めません");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("取り下げた slug の記録はオブジェクトにしてください");
  }
  for (const [slug, at] of Object.entries(data)) {
    if (typeof at !== "string" || Number.isNaN(Date.parse(at))) {
      throw new Error(`取り下げた slug の記録の時刻が読めません: ${slug}`);
    }
  }
  return data as RetiredSlugs;
}
