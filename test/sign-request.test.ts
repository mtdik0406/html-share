// Lambda の署名処理を、SSM と時計を差し替えて確かめる。呼び出し元を信じず、slug と期限をここで確かめる。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSignHandler, type SignHandlerDeps } from "../lib/sign-function/sign-request.js";
import { DAY_MS, MAX_DAYS } from "../scripts/lib/lifetime.js";
import { signPageUrl } from "../scripts/lib/signed-url.js";
import { generateTestKeyPair, TEST_DOMAIN, TEST_KEY_PAIR_ID } from "./helpers/keys.js";

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

  it("期限が 1 分未満・上限超え・数でないときは署名しない", async () => {
    const { handler } = handlerWith();
    for (const lifetimeMs of [
      MINUTE_MS - 1,
      MAX_DAYS * DAY_MS + 1,
      "60000",
      undefined,
      Number.NaN,
    ]) {
      await assert.rejects(handler({ slug: "page-a", lifetimeMs }));
    }
  });

  it("slug が正しくないときは署名しない", async () => {
    const { handler } = handlerWith();
    for (const slug of ["../x", "", "A", 1, undefined]) {
      await assert.rejects(handler({ slug, lifetimeMs: DAY_MS }));
    }
  });

  it("要求がオブジェクトでないときは署名しない", async () => {
    const { handler } = handlerWith();
    for (const event of [null, undefined, "page-a", []]) {
      await assert.rejects(handler(event));
    }
  });

  it("鍵は最初の呼び出しで 1 回だけ読む", async () => {
    const { handler, loads } = handlerWith();
    await handler({ slug: "page-a", lifetimeMs: DAY_MS });
    await handler({ slug: "page-b", lifetimeMs: DAY_MS });
    assert.equal(loads(), 1);
  });

  it("要求が正しくないときは鍵を読まない", async () => {
    const { handler, loads } = handlerWith();
    await assert.rejects(handler({ slug: "../x", lifetimeMs: DAY_MS }));
    assert.equal(loads(), 0);
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
