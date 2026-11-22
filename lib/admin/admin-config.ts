/**
 * 管理画面の設定のキー。スタックが SSM に書き、サインインの Lambda が読む。
 * - userPoolId・clientId：Cognito のユーザープールとアプリクライアント
 * - cognitoDomain：managed login のドメイン（例：<prefix>.auth.<region>.amazoncognito.com）
 * - adminDomain：管理画面の Distribution のドメイン
 */
const KEYS = ["userPoolId", "clientId", "cognitoDomain", "adminDomain"] as const;

export type AdminConfig = Record<(typeof KEYS)[number], string>;

/** スタックが SSM に書く設定を読む。値が欠けたまま動くと、間違ったドメインへリダイレクトしうるので止める。 */
export function parseAdminConfig(text: string): AdminConfig {
  const fields = (JSON.parse(text) ?? {}) as Record<string, unknown>;
  const config = {} as AdminConfig;
  for (const key of KEYS) {
    const value = fields[key];
    if (typeof value !== "string" || value === "") {
      throw new Error(`管理画面の設定に ${key} がありません`);
    }
    config[key] = value;
  }
  return config;
}
