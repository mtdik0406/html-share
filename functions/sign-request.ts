import type { SignRequest, SignResult } from "../core/api-types.js";
import { validateLifetimeMs } from "../core/lifetime.js";
import { assertSlug } from "../core/page.js";
import { signPageUrl } from "../core/signed-url.js";

export interface SignHandlerDeps {
  distributionDomainName: string;
  keyPairId: string;
  loadPrivateKey: () => Promise<string>;
  now: () => Date;
}

// 呼び出し元を信じない。ここで確かめないと、上限を超える URL や別のパスへの署名を作れてしまう。
function parseRequest(event: unknown): SignRequest {
  // Stryker disable next-line LogicalOperator: null のまま分解しても TypeError で拒むので、振る舞いは同じ
  const fields = (event ?? {}) as Record<string, unknown>;
  const slug = typeof fields.slug === "string" ? fields.slug : undefined;
  assertSlug(slug);
  // validateLifetimeMs は Number.isFinite で確かめるので、数でない値（文字列を含む）も拒む。
  const lifetimeMs = fields.lifetimeMs as number;
  validateLifetimeMs(lifetimeMs);
  return { slug, lifetimeMs };
}

/**
 * 呼び出しのたびに SSM を読まないよう、実行環境が続く間は読んだ値を持ち続ける。
 * 失敗した読み込みは持たない。一時的な失敗で、その実行環境が動けないままになるため。
 */
export function cacheUntilFailure<T>(load: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined;
  return () => {
    value ??= load().catch((err: unknown) => {
      value = undefined;
      throw err;
    });
    return value;
  };
}

export function createSignHandler(deps: SignHandlerDeps): (event: unknown) => Promise<SignResult> {
  const loadOnce = cacheUntilFailure(deps.loadPrivateKey);

  return async (event) => {
    const { slug, lifetimeMs } = parseRequest(event);
    // URL の Expires は秒単位で、署名の処理は四捨五入する。切り捨ててから渡し、上限を越えず、返す期限とも一致させる。
    const expiresAt = new Date(Math.floor((deps.now().getTime() + lifetimeMs) / 1000) * 1000);
    const url = signPageUrl({
      distributionDomainName: deps.distributionDomainName,
      slug,
      keyPairId: deps.keyPairId,
      privateKey: await loadOnce(),
      expiresAt,
    });
    return { url, expiresAt: expiresAt.toISOString() };
  };
}
