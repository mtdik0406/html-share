// Lambda の署名処理を、SSM と時計を差し替えて確かめる。呼び出し元を信じず、slug と期限をここで確かめる。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DAY_MS, MAX_DAYS } from "../../../core/lifetime.js";
import { signPageUrl } from "../../../core/signed-url.js";
import { createSignHandler, type SignHandlerDeps } from "../../../functions/sign/sign-request.js";
import { generateTestKeyPair, TEST_DOMAIN, TEST_KEY_PAIR_ID } from "../../helpers/keys.js";

const { privateKey } = generateTestKeyPair();
const DOMAIN = TEST_DOMAIN;
const KEY_PAIR_ID = TEST_KEY_PAIR_ID;
const NOW = new Date("2030-01-01T00:00:00Z");
const MINUTE_MS = 60_000;

function handlerWith(overrides: Partial<SignHandlerDeps> = {}) {
  let loads = 0;
  const handler = createSignHandler({
    distributionDomainName: DOMAIN,
    keyPairId: KEY_PAIR_ID,
    loadPrivateKey: async () => {
      loads += 1;
      return privateKey;
    },
    now: () => NOW,
    ...overrides,
  });
  return { handler, loads: () => loads };
}

describe("createSignHandler", () => {
  it("slug のページに、今から期限までの URL を署名して返す", async () => {
    const { handler } = handlerWith();
    const expiresAt = new Date(NOW.getTime() + 7 * DAY_MS);
    const result = await handler({ slug: "page-a", lifetimeMs: 7 * DAY_MS });
    assert.deepEqual(result, {
      url: signPageUrl({
        distributionDomainName: DOMAIN,
        slug: "page-a",
        keyPairId: KEY_PAIR_ID,
        privateKey,
        expiresAt,
      }),
      expiresAt: expiresAt.toISOString(),
    });
  });

  it("期限は 1 分ちょうどと上限ちょうどを受け入れる", async () => {
    const { handler } = handlerWith();
    for (const lifetimeMs of [MINUTE_MS, MAX_DAYS * DAY_MS]) {
      const result = await handler({ slug: "page-a", lifetimeMs });
      assert.equal(result.expiresAt, new Date(NOW.getTime() + lifetimeMs).toISOString());
    }
  });

  it("正しくない要求には、署名せず、鍵も読まない", async () => {
    const { handler, loads } = handlerWith();
    for (const event of [
      // 期限が 1 分未満・上限超え・数でない
      { slug: "page-a", lifetimeMs: MINUTE_MS - 1 },
      { slug: "page-a", lifetimeMs: MAX_DAYS * DAY_MS + 1 },
      { slug: "page-a", lifetimeMs: "60000" },
      { slug: "page-a", lifetimeMs: undefined },
      { slug: "page-a", lifetimeMs: Number.NaN },
      // slug が正しくない
      ...["../x", "", "A", 1, undefined].map((slug) => ({ slug, lifetimeMs: DAY_MS })),
      // オブジェクトでない
      null,
      undefined,
      "page-a",
      [],
    ]) {
      await assert.rejects(handler(event));
    }
    assert.equal(loads(), 0);
  });

  it("期限は秒に切り捨て、返す期限と URL の Expires を一致させる", async () => {
    const { handler } = handlerWith({ now: () => new Date(NOW.getTime() + 700) });
    const result = await handler({ slug: "page-a", lifetimeMs: MAX_DAYS * DAY_MS });
    const expected = NOW.getTime() + MAX_DAYS * DAY_MS;
    assert.equal(result.expiresAt, new Date(expected).toISOString());
    assert.equal(Number(new URL(result.url).searchParams.get("Expires")) * 1000, expected);
  });

  it("鍵は最初の呼び出しで 1 回だけ読む", async () => {
    const { handler, loads } = handlerWith();
    await handler({ slug: "page-a", lifetimeMs: DAY_MS });
    await handler({ slug: "page-b", lifetimeMs: DAY_MS });
    assert.equal(loads(), 1);
  });

  it("同時の呼び出しでも、鍵は 1 回だけ読む", async () => {
    const { handler, loads } = handlerWith();
    await Promise.all([
      handler({ slug: "page-a", lifetimeMs: DAY_MS }),
      handler({ slug: "page-b", lifetimeMs: DAY_MS }),
    ]);
    assert.equal(loads(), 1);
  });

  it("鍵の読み込みに失敗したら、次の呼び出しで読み直す", async () => {
    let calls = 0;
    const { handler } = handlerWith({
      loadPrivateKey: async () => {
        calls += 1;
        if (calls === 1) throw new Error("throttled");
        return privateKey;
      },
    });
    await assert.rejects(handler({ slug: "page-a", lifetimeMs: DAY_MS }));
    const result = await handler({ slug: "page-a", lifetimeMs: DAY_MS });
    assert.ok(result.url.startsWith(`https://${DOMAIN}/`));
    assert.equal(calls, 2);
  });
});
