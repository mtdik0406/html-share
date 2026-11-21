/// <reference lib="dom" />
// 管理画面の描画。slug や URL は textContent で入れ、HTML として解釈させない。
import { ApiError, fetchPages, issueUrl, type PageEntry, SignInRequired } from "./api.js";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`${selector} がありません`);
  return element;
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function showError(err: unknown): void {
  if (err instanceof SignInRequired) {
    location.assign("/auth/login");
    return;
  }
  const reason = err instanceof ApiError ? err.reason : String(err);
  $("#status").textContent = `失敗しました：${reason}`;
}

function pageRow(page: PageEntry): HTMLLIElement {
  const days = element("input", {
    type: "number",
    min: "1",
    max: String(MAX_DAYS),
    value: String(DEFAULT_DAYS),
    required: true,
  });
  days.setAttribute("aria-label", `${page.slug} の URL の日数`);
  const result = element("div", { className: "result" });
  const issue = element("button", { type: "button", textContent: "URL を発行" });
  issue.addEventListener("click", async () => {
    issue.disabled = true;
    try {
      const { url, expiresAt } = await issueUrl(fetch, page.slug, Number(days.value));
      const output = element("input", { type: "text", readOnly: true, value: url });
      const copy = element("button", { type: "button", textContent: "コピー" });
      copy.addEventListener("click", () => navigator.clipboard.writeText(url));
      const until = new Date(expiresAt).toLocaleString();
      result.replaceChildren(output, copy, element("p", { textContent: `期限：${until}` }));
    } catch (err) {
      showError(err);
    } finally {
      issue.disabled = false;
    }
  });
  const updated = page.lastModified ? new Date(page.lastModified).toLocaleString() : "";
  return element("li", {}, [
    element("strong", { textContent: page.slug }),
    element("span", { className: "updated", textContent: updated }),
    element("label", {}, [days, " 日"]),
    issue,
    result,
  ]);
}

async function render(): Promise<void> {
  try {
    const pages = await fetchPages(fetch);
    $("#pages").replaceChildren(...pages.map(pageRow));
    $("#status").textContent = pages.length === 0 ? "ページがありません" : "";
  } catch (err) {
    showError(err);
  }
}

void render();
