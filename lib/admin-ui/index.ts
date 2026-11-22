/// <reference lib="dom" />
// Stryker disable all: DOM を組み立てる入口で、Node のテストには DOM がない。API を呼ぶ部分は api.ts でテストし、描画はブラウザで確かめる
// 管理画面の描画。slug や URL は textContent で入れ、HTML として解釈させない。
import { DEFAULT_DAYS, MAX_DAYS } from "../../scripts/lib/lifetime.js";
import { ADMIN_PATHS } from "../names.js";
import { ApiError, fetchPages, issueUrl, type PageEntry, SignInRequired } from "./api.js";

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
  // 自動でサインインへ移らない。403 の原因が Cookie 切れでないと、サインインとの間を回り続けるため。
  if (err instanceof SignInRequired) {
    $("#status").replaceChildren(
      "サインインが切れています。",
      element("a", { href: ADMIN_PATHS.login, textContent: "サインインし直す" }),
    );
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
