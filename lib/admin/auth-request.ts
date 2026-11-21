import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getSignedCookies } from "@aws-sdk/cloudfront-signer";
import { DAY_MS } from "../../scripts/lib/lifetime.js";
import type { UrlRequest, UrlResponse } from "./http.js";

export interface AdminConfig {
  userPoolId: string;
  clientId: string;
  /** managed login のドメイン（例：<prefix>.auth.<region>.amazoncognito.com）。 */
  cognitoDomain: string;
  /** 管理画面の Distribution のドメイン。 */
  adminDomain: string;
}

export interface AuthHandlerDeps {
  loadConfig: () => Promise<AdminConfig>;
  region: string;
  ownerEmail: string;
  keyPairId: string;
  loadPrivateKey: () => Promise<string>;
  /** トークンのエンドポイントに、フォームの形で POST し、JSON を返す。 */
  postForm: (url: string, params: Record<string, string>) => Promise<unknown>;
  now: () => Date;
}

/** 署名付き Cookie の期限（ADR 13）。Cookie は取り消せないので、盗まれたときに使える期間を短くする。 */
export const ADMIN_SESSION_MS = DAY_MS;

/** サインインの途中で、state と PKCE の verifier を持つ Cookie。__Host- を付け、このドメインの / だけに限る。 */
export const AUTH_COOKIE = "__Host-html-share-auth";
/** Cognito の画面での操作を待つ時間。managed login も 5 分で打ち切る。 */
const AUTH_COOKIE_MAX_AGE_S = 600;

/** CloudFront が確かめる Cookie の名前は、この 3 つに決まっている。 */
const SIGNED_COOKIE_NAMES = [
  "CloudFront-Policy",
  "CloudFront-Signature",
  "CloudFront-Key-Pair-Id",
] as const;

// Cognito から戻るリダイレクトはサイトをまたぐので、Strict では戻った直後の要求に Cookie が付かない（ADR 13）。
const COOKIE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";

function setCookie(name: string, value: string, maxAgeS: number): string {
  return `${name}=${value}; ${COOKIE_ATTRIBUTES}; Max-Age=${maxAgeS}`;
}

function cookieValue(request: UrlRequest, name: string): string | undefined {
  for (const pair of request.cookies ?? []) {
    const at = pair.indexOf("=");
    if (pair.slice(0, at) === name) return pair.slice(at + 1);
  }
  return undefined;
}

const redirect = (location: string, cookies: string[] = []): UrlResponse => ({
  statusCode: 302,
  headers: { location },
  cookies,
});

const forbidden = (): UrlResponse => ({
  statusCode: 403,
  headers: { "content-type": "text/plain; charset=utf-8" },
  body: "サインインできませんでした。もう一度 /auth/login から始めてください",
});

const callbackUrl = (config: AdminConfig) => `https://${config.adminDomain}/auth/callback`;

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function startLogin(deps: AuthHandlerDeps): Promise<UrlResponse> {
  const config = await deps.loadConfig();
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: callbackUrl(config),
    scope: "openid email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return redirect(`https://${config.cognitoDomain}/oauth2/authorize?${query}`, [
    setCookie(AUTH_COOKIE, `${state}.${verifier}`, AUTH_COOKIE_MAX_AGE_S),
  ]);
}

/** サインインを始めたブラウザから戻ってきたときだけ、verifier を返す。 */
function verifierFor(request: UrlRequest): { code: string; verifier: string } | undefined {
  const query = new URLSearchParams(request.rawQueryString ?? "");
  const code = query.get("code");
  const state = query.get("state");
  const [savedState, verifier] = (cookieValue(request, AUTH_COOKIE) ?? "").split(".");
  if (query.has("error") || !code || !state || !savedState || !verifier) return undefined;
  return sameText(state, savedState) ? { code, verifier } : undefined;
}

function claimsOf(token: unknown): Record<string, unknown> | undefined {
  if (typeof token !== "string") return undefined;
  const payload = token.split(".")[1];
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8"));
    return claims && typeof claims === "object" ? (claims as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * ID トークンの署名は確かめない。トークンは Cognito のエンドポイントから TLS で直接受け取ったもので、
 * 途中で差し替えられないため（OpenID Connect Core 3.1.3.7 の 6）。中身の条件は、すべて確かめる。
 */
function isOwnerToken(deps: AuthHandlerDeps, config: AdminConfig, response: unknown): boolean {
  const claims = claimsOf((response as { id_token?: unknown } | null)?.id_token);
  if (!claims) return false;
  const issuer = `https://cognito-idp.${deps.region}.amazonaws.com/${config.userPoolId}`;
  return (
    claims.iss === issuer &&
    claims.aud === config.clientId &&
    claims.token_use === "id" &&
    typeof claims.exp === "number" &&
    claims.exp * 1000 > deps.now().getTime() &&
    typeof claims.email === "string" &&
    claims.email.toLowerCase() === deps.ownerEmail.toLowerCase() &&
    claims.email_verified === true
  );
}

function signedCookies(deps: AuthHandlerDeps, config: AdminConfig, privateKey: string): string[] {
  const expiresS = Math.floor((deps.now().getTime() + ADMIN_SESSION_MS) / 1000);
  // Resource にドメインを入れるので、この Cookie では閲覧用の Distribution のページは開けない（ADR 13）。
  const policy = JSON.stringify({
    Statement: [
      {
        Resource: `https://${config.adminDomain}/*`,
        Condition: { DateLessThan: { "AWS:EpochTime": expiresS } },
      },
    ],
  });
  const values = getSignedCookies({ keyPairId: deps.keyPairId, privateKey, policy });
  return SIGNED_COOKIE_NAMES.map((name) =>
    setCookie(name, String(values[name]), ADMIN_SESSION_MS / 1000),
  );
}

async function finishLogin(deps: AuthHandlerDeps, request: UrlRequest): Promise<UrlResponse> {
  const pending = verifierFor(request);
  if (!pending) return forbidden();
  const config = await deps.loadConfig();
  const response = await deps.postForm(`https://${config.cognitoDomain}/oauth2/token`, {
    grant_type: "authorization_code",
    client_id: config.clientId,
    code: pending.code,
    redirect_uri: callbackUrl(config),
    code_verifier: pending.verifier,
  });
  if (!isOwnerToken(deps, config, response)) return forbidden();
  return redirect("/", [
    ...signedCookies(deps, config, await deps.loadPrivateKey()),
    setCookie(AUTH_COOKIE, "", 0),
  ]);
}

async function logout(deps: AuthHandlerDeps): Promise<UrlResponse> {
  const config = await deps.loadConfig();
  const query = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: `https://${config.adminDomain}/auth/signed-out`,
  });
  return redirect(
    `https://${config.cognitoDomain}/logout?${query}`,
    SIGNED_COOKIE_NAMES.map((name) => setCookie(name, "", 0)),
  );
}

const SIGNED_OUT_PAGE = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>html-share</title></head>
<body><p>サインアウトしました。</p><p><a href="/auth/login">もう一度サインインする</a></p></body></html>
`;

export function createAuthHandler(
  deps: AuthHandlerDeps,
): (request: UrlRequest) => Promise<UrlResponse> {
  const routes: Record<string, (request: UrlRequest) => Promise<UrlResponse>> = {
    "/auth/login": () => startLogin(deps),
    "/auth/callback": (request) => finishLogin(deps, request),
    "/auth/logout": () => logout(deps),
    "/auth/signed-out": async () => ({
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: SIGNED_OUT_PAGE,
    }),
  };
  return async (request) => {
    const route = Object.hasOwn(routes, request.rawPath) ? routes[request.rawPath] : undefined;
    if (!route) return { statusCode: 404 };
    if (request.requestContext.http.method !== "GET") return { statusCode: 405 };
    return route(request);
  };
}
