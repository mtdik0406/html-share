import { createHash } from "node:crypto";

/**
 * managed login の prefix domain。パスキーの RP ID にもなるので、変えると登録し直しになる（ADR 13）。
 * アカウントごとに違い、deploy のたびに同じ値になるよう、アカウント ID のハッシュから作る。
 * アカウント ID は 12 桁の数字なので、総当たりで戻せる。AWS はアカウント ID を秘密値として扱っていないので、隠すことは目的にしない。
 */
export function cognitoDomainPrefix(account: string): string {
  return `html-share-${createHash("sha256").update(account).digest("hex").slice(0, 12)}`;
}
