// 管理画面のサインインを、Cognito と鍵と時計を差し替えて確かめる。
// 署名付き Cookie は管理画面の入場券なので、どの確かめが欠けても出さないことを見る。
import assert from "node:assert/strict";
import { createHash, verify } from "node:crypto";
import { describe, it } from "node:test";
import type { AdminConfig } from "../core/admin-config.js";
import { DAY_MS } from "../core/lifetime.js";
import {
  ADMIN_SESSION_MS,
  AUTH_COOKIE,
  type AuthHandlerDeps,
  createAuthHandler,
} from "../functions/admin-auth/auth-request.js";
import type { UrlRequest, UrlResponse } from "../functions/http.js";
import { generateTestKeyPair, TEST_KEY_PAIR_ID } from "./helpers/keys.js";

const { privateKey, publicKey } = generateTestKeyPair();
const NOW = new Date("2030-01-01T00:00:00Z");
const NOW_S = NOW.getTime() / 1000;
const REGION = "ap-northeast-1";
const OWNER = "owner@example.com";
const CONFIG: AdminConfig = {
  userPoolId: "ap-northeast-1_TEST",
  clientId: "client123",
  cognitoDomain: "hs-test.auth.ap-northeast-1.amazoncognito.com",
  adminDomain: "dadmin.cloudfront.net",
};
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${CONFIG.userPoolId}`;
const SIGNED_COOKIES = ["CloudFront-Policy", "CloudFront-Signature", "CloudFront-Key-Pair-Id"];

const b64url = (value: string | Buffer): string => Buffer.from(value).toString("base64url");

function idToken(overrides: Record<string, unknown> = {}): string {
  const claims = {
    iss: ISSUER,
    aud: CONFIG.clientId,
    token_use: "id",
    exp: NOW_S + 3600,
    email: OWNER,
    email_verified: true,
    ...overrides,
  };
  return `${b64url(JSON.stringify({ alg: "RS256" }))}.${b64url(JSON.stringify(claims))}.sig`;
}

function get(rawPath: string, extra: Partial<UrlRequest> = {}): UrlRequest {
  return { rawPath, requestContext: { http: { method: "GET" } }, ...extra };
}

function handlerWith(overrides: Partial<AuthHandlerDeps> = {}, tokenResponse: unknown = {}) {
  const posts: { url: string; params: Record<string, string> }[] = [];
  const handler = createAuthHandler({
    loadConfig: async () => CONFIG,
    region: REGION,
    ownerEmail: OWNER,
    keyPairId: TEST_KEY_PAIR_ID,
    loadPrivateKey: async () => privateKey,
    postForm: async (url, params) => {
      posts.push({ url, params });
      return tokenResponse;
    },
    now: () => NOW,
    ...overrides,
  });
  return { handler, posts };
}

/** Set-Cookie の 1 行を、名前・値・属性に分ける。 */
function parseSetCookie(line: string): { name: string; value: string; attrs: Map<string, string> } {
  const [pair, ...rest] = line.split(";").map((s) => s.trim());
  const at = (pair as string).indexOf("=");
  const attrs = new Map(
    rest.map((a) => {
      const [k, v = ""] = a.split("=");
      return [(k as string).toLowerCase(), v] as [string, string];
    }),
  );
  return { name: (pair as string).slice(0, at), value: (pair as string).slice(at + 1), attrs };
}

function cookiesOf(res: UrlResponse) {
  return new Map(
    (res.cookies ?? []).map((line) => [parseSetCookie(line).name, parseSetCookie(line)]),
  );
}

function assertProtected(attrs: Map<string, string>): void {
  // Domain が付くと、__Host- の Cookie はブラウザに捨てられ、署名付き Cookie はサブドメインにも送られる。
  assert.ok(!attrs.has("domain"), "Domain が付いている");
  assert.ok(attrs.has("secure"), "Secure がない");
  assert.ok(attrs.has("httponly"), "HttpOnly がない");
  assert.equal(attrs.get("samesite"), "Lax");
  assert.equal(attrs.get("path"), "/");
}

async function login(handler: (r: UrlRequest) => Promise<UrlResponse>) {
  const res = await handler(get("/auth/login"));
  const cookie = cookiesOf(res).get(AUTH_COOKIE);
  assert.ok(cookie, "サインインの途中の Cookie がない");
  const location = new URL(res.headers?.location ?? "");
  return { res, cookie, location };
}

/** サインインを始めてから、Cognito が戻ってきたときの要求を作る。 */
async function callbackRequest(
  handler: (r: UrlRequest) => Promise<UrlResponse>,
  edit: (q: URLSearchParams, cookie: string) => [URLSearchParams, string[]] = (q, c) => [q, [c]],
): Promise<UrlRequest> {
  const { cookie, location } = await login(handler);
  const query = new URLSearchParams({
    code: "code-1",
    state: location.searchParams.get("state") ?? "",
  });
  const [q, cookies] = edit(query, `${AUTH_COOKIE}=${cookie.value}`);
  return get("/auth/callback", { rawQueryString: q.toString(), cookies });
}

describe("createAuthHandler", () => {
  describe("/auth/login", () => {
    it("PKCE と state を付けて、Cognito の認可画面へ送る", async () => {
      const { handler } = handlerWith();
      const { res, cookie, location } = await login(handler);
      assert.equal(res.statusCode, 302);
      assert.equal(location.origin, `https://${CONFIG.cognitoDomain}`);
      assert.equal(location.pathname, "/oauth2/authorize");
      const q = location.searchParams;
      assert.equal(q.get("response_type"), "code");
      assert.equal(q.get("client_id"), CONFIG.clientId);
      assert.equal(q.get("redirect_uri"), `https://${CONFIG.adminDomain}/auth/callback`);
      assert.deepEqual(q.get("scope")?.split(" ").sort(), ["email", "openid"]);
      assert.equal(q.get("code_challenge_method"), "S256");
      assert.ok((q.get("state") ?? "").length >= 32, "state が短い");
      assertProtected(cookie.attrs);
      // __Host- を付けると、Secure・Path=/・Domain なしでなければブラウザが受け取らない
      assert.ok(AUTH_COOKIE.startsWith("__Host-"));
      assert.ok(Number(cookie.attrs.get("max-age")) > 0);
      assert.ok(Number(cookie.attrs.get("max-age")) <= 900, "途中の Cookie が長く残る");
      // 途中の Cookie に入れた値から、Cognito に渡した challenge を作れる
      const verifier = cookie.value.split(".")[1] ?? "";
      assert.equal(q.get("code_challenge"), b64url(createHash("sha256").update(verifier).digest()));
    });

    it("毎回ちがう state と verifier を作る", async () => {
      const { handler } = handlerWith();
      const a = await login(handler);
      const b = await login(handler);
      assert.notEqual(a.cookie.value, b.cookie.value);
      assert.notEqual(a.location.searchParams.get("state"), b.location.searchParams.get("state"));
    });
  });

  describe("/auth/callback", () => {
    it("コードをトークンに換え、管理画面の全体に 1 日有効な署名付き Cookie を出す", async () => {
      const { handler, posts } = handlerWith({}, { id_token: idToken() });
      const req = await callbackRequest(handler);
      const verifier = (req.cookies?.[0] ?? "").split("=")[1]?.split(".")[1];
      const res = await handler(req);

      assert.equal(res.statusCode, 302);
      assert.equal(res.headers?.location, "/");
      assert.deepEqual(posts, [
        {
          url: `https://${CONFIG.cognitoDomain}/oauth2/token`,
          params: {
            grant_type: "authorization_code",
            client_id: CONFIG.clientId,
            code: "code-1",
            redirect_uri: `https://${CONFIG.adminDomain}/auth/callback`,
            code_verifier: verifier,
          },
        },
      ]);

      const cookies = cookiesOf(res);
      for (const name of SIGNED_COOKIES) {
        const cookie = cookies.get(name);
        assert.ok(cookie, `${name} がない`);
        assertProtected(cookie.attrs);
        assert.equal(Number(cookie.attrs.get("max-age")), ADMIN_SESSION_MS / 1000);
      }
      assert.equal(ADMIN_SESSION_MS, DAY_MS);
      assert.equal(cookies.get("CloudFront-Key-Pair-Id")?.value, TEST_KEY_PAIR_ID);

      // CloudFront の Cookie は、- を +、_ を =、~ を / に置き換えた base64
      const fromCloudFront = (v: string) =>
        Buffer.from(v.replace(/-/g, "+").replace(/_/g, "=").replace(/~/g, "/"), "base64");
      const policy = fromCloudFront(cookies.get("CloudFront-Policy")?.value ?? "");
      assert.deepEqual(JSON.parse(policy.toString("utf8")), {
        Statement: [
          {
            Resource: `https://${CONFIG.adminDomain}/*`,
            Condition: { DateLessThan: { "AWS:EpochTime": NOW_S + DAY_MS / 1000 } },
          },
        ],
      });
      const signature = fromCloudFront(cookies.get("CloudFront-Signature")?.value ?? "");
      assert.ok(verify("RSA-SHA1", policy, publicKey, signature), "署名が公開鍵で確かめられない");

      // 途中の Cookie は、発行と同じ属性で消す（属性が違うと、ブラウザは消さない）
      const cleared = cookies.get(AUTH_COOKIE);
      assert.equal(cleared?.value, "");
      assert.equal(cleared?.attrs.get("max-age"), "0");
      assertProtected(cleared?.attrs ?? new Map());
    });

    it("メールアドレスは大文字と小文字を区別しない", async () => {
      const { handler } = handlerWith({}, { id_token: idToken({ email: "Owner@Example.COM" }) });
      const res = await handler(await callbackRequest(handler));
      assert.equal(res.statusCode, 302);
      assert.ok(cookiesOf(res).has("CloudFront-Signature"));
    });

    it("deploy で渡したメールアドレスの大文字と小文字も区別しない", async () => {
      const { handler } = handlerWith({ ownerEmail: "Owner@Example.COM" }, { id_token: idToken() });
      const res = await handler(await callbackRequest(handler));
      assert.equal(res.statusCode, 302);
    });

    it("ほかの Cookie と並んでいても、似た名前の Cookie と取り違えない", async () => {
      const { handler } = handlerWith({}, { id_token: idToken() });
      const ok = await callbackRequest(handler, (q, c) => [q, ["other=1", "broken", c]]);
      assert.equal((await handler(ok)).statusCode, 302);
      const lookalike = await callbackRequest(handler, (q, c) => [q, [`${c.replace("=", "x=")}`]]);
      assert.equal((await handler(lookalike)).statusCode, 403);
    });

    it("期限が 1 秒でも残るトークンは受け入れる", async () => {
      const { handler } = handlerWith({}, { id_token: idToken({ exp: NOW_S + 1 }) });
      const res = await handler(await callbackRequest(handler));
      assert.equal(res.statusCode, 302);
    });

    it("サインインを始めた本人でなければ、トークンに換えず 403 にする", async () => {
      const edits: ((q: URLSearchParams, c: string) => [URLSearchParams, string[]])[] = [
        (q) => [q, []],
        (_q, c) => [new URLSearchParams({ code: "code-1", state: "other" }), [c]],
        (q, c) => {
          q.delete("code");
          return [q, [c]];
        },
        (q, c) => {
          q.delete("state");
          return [q, [c]];
        },
        (q, c) => {
          q.set("error", "access_denied");
          return [q, [c]];
        },
        (q) => [q, [`${AUTH_COOKIE}=broken`]],
      ];
      const noCookies = async (handler: (r: UrlRequest) => Promise<UrlResponse>) => {
        const req = await callbackRequest(handler);
        delete req.cookies;
        return req;
      };
      for (const make of [
        ...edits.map(
          (edit) => (h: (r: UrlRequest) => Promise<UrlResponse>) => callbackRequest(h, edit),
        ),
        noCookies,
      ]) {
        const { handler, posts } = handlerWith({}, { id_token: idToken() });
        const res = await handler(await make(handler));
        assert.equal(res.statusCode, 403);
        assert.deepEqual(posts, []);
        for (const name of SIGNED_COOKIES) assert.ok(!cookiesOf(res).has(name));
      }
    });

    it("トークンが所有者のものと確かめられなければ、Cookie を出さず 403 にする", async () => {
      const responses: unknown[] = [
        {},
        { id_token: 1 },
        { id_token: "not-a-jwt" },
        { id_token: "a.!!!.c" },
        { id_token: `a.${b64url("null")}.c` },
        { id_token: `a.${b64url("1")}.c` },
        { id_token: idToken({ iss: `${ISSUER}x` }) },
        { id_token: idToken({ aud: "other" }) },
        { id_token: idToken({ token_use: "access" }) },
        { id_token: idToken({ exp: NOW_S }) },
        { id_token: idToken({ exp: "later" }) },
        // 数に変わる文字列や配列も、数としては受け取らない
        { id_token: idToken({ exp: String(NOW_S + 3600) }) },
        { id_token: idToken({ exp: [NOW_S + 3600] }) },
        { id_token: idToken({ email: "other@example.com" }) },
        { id_token: idToken({ email: undefined }) },
        { id_token: idToken({ email_verified: false }) },
        { id_token: idToken({ email_verified: "true" }) },
        { id_token: idToken({ email_verified: undefined }) },
        null,
      ];
      for (const response of responses) {
        const { handler } = handlerWith({}, response);
        const res = await handler(await callbackRequest(handler));
        assert.equal(res.statusCode, 403, JSON.stringify(response));
        for (const name of SIGNED_COOKIES) assert.ok(!cookiesOf(res).has(name));
      }
    });

    it("トークンに換えられなければ、失敗を投げる", async () => {
      const { handler } = handlerWith({
        postForm: async () => {
          throw new Error("token endpoint down");
        },
      });
      await assert.rejects(handler(await callbackRequest(handler)));
    });
  });

  it("/auth/logout は、署名付き Cookie を消し、Cognito からもサインアウトさせる", async () => {
    const { handler } = handlerWith();
    const res = await handler(get("/auth/logout"));
    assert.equal(res.statusCode, 302);
    const location = new URL(res.headers?.location ?? "");
    assert.equal(location.origin, `https://${CONFIG.cognitoDomain}`);
    assert.equal(location.pathname, "/logout");
    assert.equal(location.searchParams.get("client_id"), CONFIG.clientId);
    assert.equal(
      location.searchParams.get("logout_uri"),
      `https://${CONFIG.adminDomain}/auth/signed-out`,
    );
    const cookies = cookiesOf(res);
    for (const name of SIGNED_COOKIES) {
      const cleared = cookies.get(name);
      assert.equal(cleared?.value, "", name);
      assert.equal(cleared?.attrs.get("max-age"), "0", `${name} を消していない`);
      assertProtected(cleared?.attrs ?? new Map());
    }
  });

  it("/auth/signed-out は、もう一度サインインする入口を見せる", async () => {
    const { handler } = handlerWith();
    const res = await handler(get("/auth/signed-out"));
    assert.equal(res.statusCode, 200);
    assert.match(res.headers?.["content-type"] ?? "", /^text\/html/);
    assert.match(res.body ?? "", /href="\/auth\/login"/);
  });

  it("ほかのパスは 404、GET 以外は 405 にする", async () => {
    const { handler } = handlerWith();
    assert.equal((await handler(get("/auth/other"))).statusCode, 404);
    assert.equal((await handler(get("/auth/"))).statusCode, 404);
    const post = { rawPath: "/auth/login", requestContext: { http: { method: "POST" } } };
    assert.equal((await handler(post)).statusCode, 405);
  });
});
