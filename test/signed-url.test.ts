// CloudFront と同じ手順で署名を検証し、配った URL が受け入れられるか・改ざんが弾かれるかを確かめる。
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { signPageUrl } from "../scripts/lib/signed-url.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const DOMAIN = "d111.cloudfront.net";
const KEY_PAIR_ID = "K2TESTKEYPAIRID";
// Expires は秒単位なので、丸めの影響を受けない秒ちょうどの時刻を使う。
const EXPIRES_AT = new Date("2030-01-01T00:00:00Z");

/**
 * CloudFront が canned policy の URL を受け入れるかを判定する。
 * クエリを除いた URL と Expires からポリシー文を組み立て直し、Key-Pair-Id の公開鍵で署名を照合する。
 * 署名は URL で使えない文字を置き換えた base64（+ → -、= → _、/ → ~）。
 */
function cloudFrontAccepts(signedUrl: string, now: Date): boolean {
  const url = new URL(signedUrl);
  const expires = Number(url.searchParams.get("Expires"));
  const signature = url.searchParams.get("Signature") ?? "";
  if (url.searchParams.get("Key-Pair-Id") !== KEY_PAIR_ID) return false;
  if (now.getTime() >= expires * 1000) return false;

  const resource = `${url.origin}${url.pathname}`;
  const policy = JSON.stringify({
    Statement: [{ Resource: resource, Condition: { DateLessThan: { "AWS:EpochTime": expires } } }],
  });
  const base64 = signature.replace(/-/g, "+").replace(/_/g, "=").replace(/~/g, "/");
  return createVerify("RSA-SHA1").update(policy).verify(publicKey, base64, "base64");
}

const sign = (slug: string): string =>
  signPageUrl({
    distributionDomainName: DOMAIN,
    slug,
    keyPairId: KEY_PAIR_ID,
    privateKey,
    expiresAt: EXPIRES_AT,
  });

const BEFORE_EXPIRY = new Date(EXPIRES_AT.getTime() - 1000);

describe("signPageUrl", () => {
  it("期限内なら受け入れられる", () => {
    assert.equal(cloudFrontAccepts(sign("page-a"), BEFORE_EXPIRY), true);
  });

  it("期限を過ぎると拒否される", () => {
    assert.equal(cloudFrontAccepts(sign("page-a"), EXPIRES_AT), false);
  });

  it("URL の Expires は指定した期限を表す", () => {
    const expires = new URL(sign("page-a")).searchParams.get("Expires");
    assert.equal(Number(expires) * 1000, EXPIRES_AT.getTime());
  });

  it("Expires を延ばすと拒否される", () => {
    const url = new URL(sign("page-a"));
    url.searchParams.set("Expires", String(EXPIRES_AT.getTime() / 1000 + 86_400));
    assert.equal(cloudFrontAccepts(url.toString(), BEFORE_EXPIRY), false);
  });

  it("別のページのパスに付け替えると拒否される", () => {
    const a = new URL(sign("page-a"));
    const b = new URL(sign("page-b"));
    b.search = a.search;
    assert.equal(cloudFrontAccepts(b.toString(), BEFORE_EXPIRY), false);
  });

  it("別の秘密鍵で署名した URL は拒否される", () => {
    const { privateKey: otherKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const forged = signPageUrl({
      distributionDomainName: DOMAIN,
      slug: "page-a",
      keyPairId: KEY_PAIR_ID,
      privateKey: otherKey,
      expiresAt: EXPIRES_AT,
    });
    assert.equal(cloudFrontAccepts(forged, BEFORE_EXPIRY), false);
  });
});
