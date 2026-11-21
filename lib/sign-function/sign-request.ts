import { validateLifetimeMs } from "../../scripts/lib/lifetime.js";
import { assertSlug } from "../../scripts/lib/page.js";
import { signPageUrl } from "../../scripts/lib/signed-url.js";

export interface SignHandlerDeps {
  distributionDomainName: string;
  keyPairId: string;
  loadPrivateKey: () => Promise<string>;
  now: () => Date;
}

export interface SignResult {
  url: string;
  expiresAt: string;
}

interface SignRequest {
  slug: string;
  lifetimeMs: number;
}

// 呼び出し元を信じない。ここで確かめないと、上限を超える URL や別のパスへの署名を作れてしまう。
function parseRequest(event: unknown): SignRequest {
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    throw new Error("要求は { slug, lifetimeMs } の形にしてください");
  }
  const fields = event as Record<string, unknown>;
  const slug = typeof fields.slug === "string" ? fields.slug : undefined;
  assertSlug(slug);
  const { lifetimeMs } = fields;
  if (typeof lifetimeMs !== "number") throw new Error("lifetimeMs は数にしてください");
  validateLifetimeMs(lifetimeMs);
  return { slug, lifetimeMs };
}

export function createSignHandler(deps: SignHandlerDeps): (event: unknown) => Promise<SignResult> {
  // 呼び出しのたびに SSM を読まないよう、実行環境が続く間は鍵を持ち続ける。
  // 失敗した読み込みは持たない。一時的な失敗で、その実行環境が署名できないままになるため。
  let privateKey: Promise<string> | undefined;
  const loadOnce = (): Promise<string> => {
    privateKey ??= deps.loadPrivateKey().catch((err: unknown) => {
      privateKey = undefined;
      throw err;
    });
    return privateKey;
  };

  return async (event) => {
    const { slug, lifetimeMs } = parseRequest(event);
    const expiresAt = new Date(deps.now().getTime() + lifetimeMs);
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
