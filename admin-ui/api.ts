// 管理画面のブラウザで動く。Node の API に頼らず、ブラウザと Node の両方にある fetch と crypto.subtle だけを使う。

import type { PageEntry } from "../admin/pages-request.js";
import { ADMIN_PATHS } from "../names.js";
import type { SignResult } from "../sign-function/sign-request.js";

export type { PageEntry };

/** 署名付き Cookie が切れたか、ない。CloudFront が 403 を返す。 */
export class SignInRequired extends Error {}

/** API が失敗を返した。画面には reason を見せる。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(reason);
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  if (res.status === 403) throw new SignInRequired();
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(body.error ?? `HTTP ${res.status}`));
  return body;
}

export async function fetchPages(fetch: Fetch): Promise<PageEntry[]> {
  const body = await readJson(await fetch(ADMIN_PATHS.pagesApi));
  return body.pages as PageEntry[];
}

export async function issueUrl(fetch: Fetch, slug: string, days: number): Promise<SignResult> {
  const body = JSON.stringify({ days });
  const res = await fetch(`${ADMIN_PATHS.pagesApi}${encodeURIComponent(slug)}/urls`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // CloudFront の OAC で Function URL に POST するときは、本文の SHA-256 が要る。
      "x-amz-content-sha256": await sha256Hex(body),
    },
    body,
  });
  return (await readJson(res)) as unknown as SignResult;
}

export interface ErrorView {
  text: string;
  /** サインインし直す入口。あれば画面にリンクとして出す。 */
  signInHref?: string;
}

/**
 * 失敗を画面に出す形にする。Cookie 切れでも自動でサインインへ移らない。
 * 403 の原因が Cookie 切れでないと、サインインとの間を回り続けるため。
 */
export function errorView(err: unknown): ErrorView {
  if (err instanceof SignInRequired) {
    // Stryker disable next-line StringLiteral: 表示の文言
    return { text: "サインインが切れています。", signInHref: ADMIN_PATHS.login };
  }
  const reason = err instanceof ApiError ? err.reason : String(err);
  return { text: `失敗しました：${reason}` };
}
