// 管理画面のページの API を、S3 と署名を差し替えて確かめる。CloudFront を通っても、要求の中身は信じない。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UrlRequest } from "../lib/admin/http.js";
import { createPagesHandler, type PagesHandlerDeps } from "../lib/admin/pages-request.js";
import { DAY_MS, MAX_DAYS } from "../scripts/lib/lifetime.js";

const JSON_HEADERS = { "content-type": "application/json" };

function request(method: string, rawPath: string, extra: Partial<UrlRequest> = {}): UrlRequest {
  return { rawPath, requestContext: { http: { method } }, ...extra };
}

function post(slug: string, body: unknown, headers: Record<string, string> = JSON_HEADERS) {
  return request("POST", `/api/pages/${slug}/urls`, {
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function handlerWith(overrides: Partial<PagesHandlerDeps> = {}) {
  const signed: { slug: string; lifetimeMs: number }[] = [];
  const handler = createPagesHandler({
    listPages: async () => [],
    signPage: async (input) => {
      signed.push(input);
      return {
        url: `https://d111.cloudfront.net/pages/${input.slug}/index.html?sig`,
        expiresAt: "x",
      };
    },
    ...overrides,
  });
  return { handler, signed };
}

const parse = (body: string | undefined): unknown => JSON.parse(body ?? "");

describe("createPagesHandler", () => {
  it("一覧は、ページを新しい順に返す", async () => {
    const { handler } = handlerWith({
      listPages: async () => [
        { slug: "old", lastModified: "2030-01-01T00:00:00.000Z" },
        { slug: "new", lastModified: "2030-01-03T00:00:00.000Z" },
        { slug: "mid", lastModified: "2030-01-02T00:00:00.000Z" },
      ],
    });
    const res = await handler(request("GET", "/api/pages/"));
    assert.equal(res.statusCode, 200);
    assert.match(res.headers?.["content-type"] ?? "", /^application\/json/);
    assert.deepEqual(parse(res.body), {
      pages: [
        { slug: "new", lastModified: "2030-01-03T00:00:00.000Z" },
        { slug: "mid", lastModified: "2030-01-02T00:00:00.000Z" },
        { slug: "old", lastModified: "2030-01-01T00:00:00.000Z" },
      ],
    });
  });

  it("発行は、日数を期限にして署名し、URL と期限を返す", async () => {
    const { handler, signed } = handlerWith();
    const res = await handler(post("page-a", { days: 7 }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(signed, [{ slug: "page-a", lifetimeMs: 7 * DAY_MS }]);
    assert.deepEqual(parse(res.body), {
      url: "https://d111.cloudfront.net/pages/page-a/index.html?sig",
      expiresAt: "x",
    });
  });

  it("本文が base64 で届いても読める", async () => {
    const { handler, signed } = handlerWith();
    const res = await handler({
      ...post("page-a", ""),
      body: Buffer.from(JSON.stringify({ days: 1 })).toString("base64"),
      isBase64Encoded: true,
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(signed, [{ slug: "page-a", lifetimeMs: DAY_MS }]);
  });

  it("期限の上限ちょうどは受け入れる", async () => {
    const { handler, signed } = handlerWith();
    const res = await handler(post("page-a", { days: MAX_DAYS }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(signed, [{ slug: "page-a", lifetimeMs: MAX_DAYS * DAY_MS }]);
  });

  it("正しくない発行の要求は 400 にし、署名しない", async () => {
    const { handler, signed } = handlerWith();
    for (const req of [
      post("page-a", { days: MAX_DAYS + 1 }),
      post("page-a", { days: 0 }),
      post("page-a", { days: "7" }),
      post("page-a", {}),
      post("page-a", "not json"),
      post("page-a", "null"),
      post("Page_A", { days: 7 }),
      // ほかのサイトのフォームからは、この Content-Type を送れない
      post("page-a", { days: 7 }, { "content-type": "text/plain" }),
      post("page-a", { days: 7 }, {}),
    ]) {
      const res = await handler(req);
      assert.equal(res.statusCode, 400, `${req.rawPath} ${req.body}`);
    }
    assert.deepEqual(signed, []);
  });

  it("Content-Type に charset が付いていても受け入れる", async () => {
    const { handler } = handlerWith();
    const res = await handler(
      post("page-a", { days: 7 }, { "content-type": "application/json; charset=utf-8" }),
    );
    assert.equal(res.statusCode, 200);
  });

  it("ほかのパスは 404、合わないメソッドは 405 にする", async () => {
    const { handler, signed } = handlerWith();
    const cases: [UrlRequest, number][] = [
      [request("GET", "/api/pages"), 404],
      [request("GET", "/api/pages/page-a"), 404],
      [request("GET", "/api/pages/page-a/urls/extra"), 404],
      [request("GET", "/api/other/"), 404],
      [request("POST", "/api/pages/", { headers: JSON_HEADERS, body: "{}" }), 405],
      [request("GET", "/api/pages/page-a/urls"), 405],
      [request("DELETE", "/api/pages/page-a/urls"), 405],
    ];
    for (const [req, status] of cases) {
      const res = await handler(req);
      assert.equal(res.statusCode, status, `${req.requestContext.http.method} ${req.rawPath}`);
    }
    assert.deepEqual(signed, []);
  });

  it("署名に失敗したら、失敗を投げる（URL らしいものを返さない）", async () => {
    const { handler } = handlerWith({
      signPage: async () => {
        throw new Error("ssm down");
      },
    });
    await assert.rejects(handler(post("page-a", { days: 7 })));
  });
});
