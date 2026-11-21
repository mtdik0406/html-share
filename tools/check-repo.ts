import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  adrChangedOutsideStatus,
  type Finding,
  findForbiddenText,
  findMessageAssertions,
  findMissingReferences,
  findPrivateKeyAccess,
} from "./lib/repo-rules.js";

// 規則そのものと、そのテストの例は、見つける対象の文字列を含む。
const EXEMPT_FROM_TEXT_RULES = new Set(["tools/lib/repo-rules.ts", "test/repo-rules.test.ts"]);

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });

function files(): string[] {
  return git("ls-files", "--cached", "--others", "--exclude-standard")
    .split("\n")
    .filter((f) => f !== "");
}

// 消したがまだ git に伝えていないファイルは、読まない。
function readText(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const buffer = readFileSync(path);
  return buffer.includes(0) ? undefined : buffer.toString("utf8");
}

function originalAdr(path: string): string | undefined {
  const added = git("log", "--diff-filter=A", "--format=%H", "--", path).trim().split("\n").at(-1);
  return added ? git("show", `${added}:${path}`) : undefined;
}

const known = {
  scripts: new Set(Object.keys(JSON.parse(readFileSync("package.json", "utf8")).scripts)),
  skills: new Set(readdirSync(".claude/skills")),
};

const problems: string[] = [];
const report = (path: string, findings: Finding[]) => {
  for (const { line, reason } of findings) problems.push(`${path}:${line} ${reason}`);
};

// 履歴が浅いと、ADR の最初の版が見つからず、書き換えを見逃す。
if (git("rev-parse", "--is-shallow-repository").trim() === "true") {
  problems.push("git の履歴が浅いので、ADR の書き換えを確かめられません（fetch-depth: 0 にする）");
}

for (const path of files()) {
  const text = readText(path);
  if (text === undefined) continue;
  if (!EXEMPT_FROM_TEXT_RULES.has(path)) report(path, findForbiddenText(text));
  if (path.startsWith("test/") && path.endsWith(".ts")) report(path, findMessageAssertions(text));
  if (!EXEMPT_FROM_TEXT_RULES.has(path)) report(path, findPrivateKeyAccess(path, text));
  // ADR は決めた時点の記録なので、後で名前が変わった参照も残す。
  if (path.endsWith(".md") && !path.startsWith("docs/adr/")) {
    report(path, findMissingReferences(text, known));
  }
  if (path.startsWith("docs/adr/")) {
    const original = originalAdr(path);
    if (original !== undefined && adrChangedOutsideStatus(original, text)) {
      problems.push(`${path} 採用した ADR を書き換えている（新しい ADR で置き換える）`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
}
