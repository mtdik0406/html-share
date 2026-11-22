import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PRIVATE_KEY_FILE, PUBLIC_KEY_FILE } from "../../core/paths.js";

/**
 * 既存の鍵は片方でもあれば上書きしない。
 * CloudFront に登録済みの公開鍵と手元の秘密鍵がずれると、すべての署名付き URL が通らなくなるため。
 */
export function writeKeyPair(dir: string): { privateKeyPath: string; publicKeyPath: string } {
  const privateKeyPath = join(dir, PRIVATE_KEY_FILE);
  const publicKeyPath = join(dir, PUBLIC_KEY_FILE);

  const existing = [privateKeyPath, publicKeyPath].filter((p) => existsSync(p));
  if (existing.length > 0) {
    throw new Error(`鍵はすでにあります。上書きしません: ${existing.join(", ")}`);
  }

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    // spki の PEM が、CloudFront の要求する "BEGIN PUBLIC KEY" の形になる。
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // "wx" は、上の存在確認と書き込みの間に別のプロセスが作った場合の保険。
  writeFileSync(privateKeyPath, privateKey, { flag: "wx", mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey, { flag: "wx", mode: 0o644 });

  return { privateKeyPath, publicKeyPath };
}
