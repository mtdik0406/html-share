import { DAY_MS, validateLifetimeMs } from "../../scripts/lib/lifetime.js";
import { assertSlug } from "../../scripts/lib/page.js";
import { ADMIN_PATHS } from "../names.js";
import { bodyText, json, type UrlRequest, type UrlResponse } from "./http.js";

export interface PageEntry {
  slug: string;
  lastModified: string;
}

export interface PagesHandlerDeps {
  listPages: () => Promise<PageEntry[]>;
  /** 署名の Lambda と同じ処理。slug と期限は、ここでも確かめる。 */
  signPage: (input: { slug: string; lifetimeMs: number }) => Promise<{
    url: string;
    expiresAt: string;
  }>;
}

const LIST_PATH = ADMIN_PATHS.pagesApi;
const ISSUE_PATH = new RegExp(`^${LIST_PATH}([^/]+)/urls$`);

/**
 * ほかのサイトのフォームは application/json を送れず、fetch で送るには事前の確認（CORS）が要る。
 * Function URL は CORS を許していないので、ほかのサイトからは発行できない。
 */
function assertJson(request: UrlRequest): void {
  // Stryker disable next-line StringLiteral,OptionalChaining: ヘッダーがなければ、どう変えても拒む（TypeError も 400 になる）ので、振る舞いは同じ
  const type = request.headers?.["content-type"] ?? "";
  // Stryker disable next-line OptionalChaining: split は必ず 1 つ以上の要素を返すので、振る舞いは同じ
  if (type.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    // Stryker disable next-line StringLiteral: 表示の文言
    throw new Error("Content-Type は application/json にしてください");
  }
}

/** 要求の誤りは、ここで投げる。JSON として読めない本文も含む。 */
function parseIssue(request: UrlRequest, slug: string): { slug: string; lifetimeMs: number } {
  assertJson(request);
  const body: unknown = JSON.parse(bodyText(request));
  // 本文が null なら TypeError になり、呼び出し側で 400 にする。
  const days = (body as { days?: unknown }).days;
  // Stryker disable next-line StringLiteral: 表示の文言
  if (typeof days !== "number") throw new Error("days は数にしてください");
  const lifetimeMs = days * DAY_MS;
  assertSlug(slug);
  validateLifetimeMs(lifetimeMs);
  return { slug, lifetimeMs };
}

async function issue(
  deps: PagesHandlerDeps,
  request: UrlRequest,
  slug: string,
): Promise<UrlResponse> {
  let input: { slug: string; lifetimeMs: number };
  try {
    input = parseIssue(request, slug);
  } catch (err) {
    // Stryker disable next-line ObjectLiteral: 表示の文言
    return json(400, { error: (err as Error).message });
  }
  // 署名の失敗（SSM など）は要求の誤りではないので、投げて Lambda の失敗にする。
  return json(200, await deps.signPage(input));
}

async function list(deps: PagesHandlerDeps): Promise<UrlResponse> {
  const pages = [...(await deps.listPages())].sort((a, b) =>
    b.lastModified.localeCompare(a.lastModified),
  );
  return json(200, { pages });
}

// Stryker disable next-line ObjectLiteral,StringLiteral: 表示の文言
const METHOD_NOT_ALLOWED = json(405, { error: "method not allowed" });

export function createPagesHandler(
  deps: PagesHandlerDeps,
): (request: UrlRequest) => Promise<UrlResponse> {
  return async (request) => {
    const method = request.requestContext.http.method;
    if (request.rawPath === LIST_PATH) {
      return method === "GET" ? list(deps) : METHOD_NOT_ALLOWED;
    }
    const slug = ISSUE_PATH.exec(request.rawPath)?.[1];
    if (slug !== undefined) {
      return method === "POST" ? issue(deps, request, slug) : METHOD_NOT_ALLOWED;
    }
    // Stryker disable next-line ObjectLiteral,StringLiteral: 表示の文言
    return json(404, { error: "not found" });
  };
}
