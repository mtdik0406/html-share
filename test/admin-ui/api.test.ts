// 管理画面の JavaScript が API を呼ぶ部分。fetch を差し替えて、送る要求の形と、失敗の扱いを確かめる。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { ApiError, errorView, fetchPages, issueUrl, SignInRequired } from "../../admin-ui/api.js";
import { ADMIN_PATHS } from "../../core/names.js";

interface Sent {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(status: number, body: unknown) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    sent.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, sent };
}

describe("fetchPages", () => {
  it("一覧の API を GET で呼び、ページを返す", async () => {
    const pages = [{ slug: "page-a", lastModified: "2030-01-01T00:00:00.000Z" }];
    const { fetch, sent } = fakeFetch(200, { pages });
    assert.deepEqual(await fetchPages(fetch), pages);
    assert.equal(sent[0]?.url, "/api/pages/");
    assert.equal(sent[0]?.init?.method ?? "GET", "GET");
  });

  it("Cookie が切れて 403 なら、サインインが要ると知らせる", async () => {
    const { fetch } = fakeFetch(403, {});
    await assert.rejects(fetchPages(fetch), SignInRequired);
  });

  it("ほかの失敗は、サインインとは別の失敗にする", async () => {
    const { fetch } = fakeFetch(500, {});
    await assert.rejects(fetchPages(fetch), (err) => err instanceof ApiError && err.status === 500);
  });
});

describe("issueUrl", () => {
  it("本文の SHA-256 を付けて、JSON で POST する", async () => {
    const { fetch, sent } = fakeFetch(200, {
      url: "https://x/pages/a/index.html?s",
      expiresAt: "t",
    });
    assert.deepEqual(await issueUrl(fetch, "page-a", 7), {
      url: "https://x/pages/a/index.html?s",
      expiresAt: "t",
    });
    const [req] = sent;
    assert.equal(req?.url, "/api/pages/page-a/urls");
    assert.equal(req?.init?.method, "POST");
    const body = String(req?.init?.body);
    assert.deepEqual(JSON.parse(body), { days: 7 });
    const headers = new Headers(req?.init?.headers);
    assert.equal(headers.get("content-type"), "application/json");
    // OAC で Function URL に POST するときは、本文のハッシュが要る
    assert.equal(
      headers.get("x-amz-content-sha256"),
      createHash("sha256").update(body).digest("hex"),
    );
  });

  it("slug はパスに入れる前にエスケープする", async () => {
    const { fetch, sent } = fakeFetch(200, { url: "u", expiresAt: "t" });
    await issueUrl(fetch, "a/../b", 1);
    assert.equal(sent[0]?.url, "/api/pages/a%2F..%2Fb/urls");
  });

  it("403 ならサインインが要ると知らせ、ほかの失敗は API の理由を添えて失敗する", async () => {
    await assert.rejects(issueUrl(fakeFetch(403, {}).fetch, "page-a", 7), SignInRequired);
    await assert.rejects(
      issueUrl(fakeFetch(400, { error: "reason-from-api" }).fetch, "page-a", 31),
      (err) => err instanceof ApiError && err.status === 400 && err.reason === "reason-from-api",
    );
  });
});

describe("errorView", () => {
  it("Cookie が切れたら、自動で移らず、サインインし直す入口を見せる", () => {
    const view = errorView(new SignInRequired());
    assert.equal(view.signInHref, ADMIN_PATHS.login);
    assert.ok(view.text.length > 0);
  });

  it("API の失敗は、API の理由を見せ、サインインへの入口は出さない", () => {
    const view = errorView(new ApiError(400, "reason-from-api"));
    assert.ok(view.text.includes("reason-from-api"));
    assert.equal(view.signInHref, undefined);
  });

  it("ほかの失敗も、内容を見せる", () => {
    const view = errorView(new TypeError("network-down"));
    assert.ok(view.text.includes("network-down"));
    assert.equal(view.signInHref, undefined);
  });
});
