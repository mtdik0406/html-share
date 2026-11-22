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

class BadRequest extends Error {}

/**
 * ほかのサイトのフォームは application/json を送れず、fetch で送るには事前の確認（CORS）が要る。
 * Function URL は CORS を許していないので、ほかのサイトからは発行できない。
 */
function assertJson(request: UrlRequest): void {
  const type = request.headers?.["content-type"] ?? "";
  if (type.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    // Stryker disable next-line StringLiteral: 表示の文言
    throw new BadRequest("Content-Type は application/json にしてください");
  }
}

function parseIssue(request: UrlRequest, slug: string): { slug: string; lifetimeMs: number } {
  assertJson(request);
  let body: unknown;
  try {
    body = JSON.parse(bodyText(request));
    // Stryker disable next-line BlockStatement: 読めなければ body が undefined のまま days の確かめで 400 になるので、振る舞いは同じ
  } catch {
    // Stryker disable next-line StringLiteral: 表示の文言
    throw new BadRequest("本文が JSON ではありません");
  }
  const days = (body as { days?: unknown } | null)?.days;
  // Stryker disable next-line StringLiteral: 表示の文言
  if (typeof days !== "number") throw new BadRequest("days は数にしてください");
  const lifetimeMs = days * DAY_MS;
  try {
    assertSlug(slug);
    validateLifetimeMs(lifetimeMs);
  } catch (err) {
    throw new BadRequest((err as Error).message);
  }
  return { slug, lifetimeMs };
}

async function issue(
  deps: PagesHandlerDeps,
  request: UrlRequest,
  slug: string,
): Promise<UrlResponse> {
  try {
    return json(200, await deps.signPage(parseIssue(request, slug)));
  } catch (err) {
    // Stryker disable next-line ObjectLiteral: 表示の文言
    if (err instanceof BadRequest) return json(400, { error: err.message });
    throw err;
  }
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
