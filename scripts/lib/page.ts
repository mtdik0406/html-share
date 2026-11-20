/** 先頭 1 文字 ＋ 残り 0〜63 文字 ＝ 最大 64 文字 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** URL のパスと S3 のキーにそのまま入るので、`/` や `..` でパスを抜け出せない文字だけに絞る。 */
export function assertSlug(slug: string | undefined): asserts slug is string {
  if (slug === undefined || !SLUG_PATTERN.test(slug)) {
    throw new Error(
      `slug は英小文字・数字・ハイフンで、先頭は英数字、64 文字以内にしてください: ${slug ?? "(指定なし)"}`,
    );
  }
}

/** 同期はこの下だけを手元と同じにする。ほかの場所のオブジェクトには触れない。 */
export const PAGES_PREFIX = "pages/";

/** CloudFront は URL のパスをそのまま S3 のキーとして読むので、pageUrl と必ず対応させる。 */
export function pageKey(slug: string): string {
  return `${PAGES_PREFIX}${slug}/index.html`;
}

export function pageUrl(distributionDomainName: string, slug: string): string {
  return `https://${distributionDomainName}/${pageKey(slug)}`;
}
