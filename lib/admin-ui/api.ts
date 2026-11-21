// 管理画面のブラウザで動く。Node の API に頼らず、ブラウザと Node の両方にある fetch と crypto.subtle だけを使う。

export interface PageEntry {
  slug: string;
  lastModified: string;
}

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
  const body = await readJson(await fetch("/api/pages/"));
  return body.pages as PageEntry[];
}

export async function issueUrl(
  fetch: Fetch,
  slug: string,
  days: number,
): Promise<{ url: string; expiresAt: string }> {
  const body = JSON.stringify({ days });
  const res = await fetch(`/api/pages/${encodeURIComponent(slug)}/urls`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // CloudFront の OAC で Function URL に POST するときは、本文の SHA-256 が要る。
      "x-amz-content-sha256": await sha256Hex(body),
    },
    body,
  });
  return (await readJson(res)) as { url: string; expiresAt: string };
}
