import type { AdminConfig } from "./auth-request.js";

const KEYS = ["userPoolId", "clientId", "cognitoDomain", "adminDomain"] as const;

/** スタックが SSM に書く設定を読む。値が欠けたまま動くと、間違ったドメインへリダイレクトしうるので止める。 */
export function parseAdminConfig(text: string): AdminConfig {
  const fields = (JSON.parse(text) ?? {}) as Record<string, unknown>;
  const config = {} as Record<(typeof KEYS)[number], string>;
  for (const key of KEYS) {
    const value = fields[key];
    if (typeof value !== "string" || value === "") {
      throw new Error(`管理画面の設定に ${key} がありません`);
    }
    config[key] = value;
  }
  return config;
}
