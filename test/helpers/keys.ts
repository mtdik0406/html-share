import { generateKeyPairSync } from "node:crypto";

/** .keys/ の本物の鍵に依存しないよう、テストごとに使い捨ての鍵を作る。 */
export function generateTestKeyPair(): { publicKey: string; privateKey: string } {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

export const TEST_DOMAIN = "d111.cloudfront.net";
export const TEST_KEY_PAIR_ID = "K2TESTKEYPAIRID";
