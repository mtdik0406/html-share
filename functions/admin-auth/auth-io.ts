import { loadSigningKey, type SsmSender } from "../../scripts/lib/signing-key.js";
import { type AdminConfig, parseAdminConfig } from "./admin-config.js";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** トークンのエンドポイントに、フォームの形で POST する。 */
export function createPostForm(
  fetch: Fetch,
): (url: string, params: Record<string, string>) => Promise<unknown> {
  return async (url, params) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      // トークンのエンドポイントが別の場所へ送り返しても、ついて行かない。
      redirect: "error",
    });
    // 失敗の応答（invalid_grant など）にも JSON が返る。id_token がなければ、呼び出し側が拒む。
    // JSON でない応答（5xx の HTML など）も、id_token がないものとして拒む。
    return res.json().catch(() => undefined);
  };
}

/**
 * 設定は持ち続けない。ユーザープールやアプリクライアントが作り直されても、実行環境が古い値を使い続けないため。
 * サインインの要求は少ないので、毎回 SSM を読んでも費用と遅れは小さい。
 */
export function createConfigLoader(ssm: SsmSender, name: string): () => Promise<AdminConfig> {
  // String のパラメータも、復号を求める読み方でそのまま読める。
  return async () => parseAdminConfig(await loadSigningKey(ssm, name));
}
