import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { changedLines, survivorsOnChangedLines } from "./lib/review-scope.js";

const REPORT = "reports/mutation/mutation.json";
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });

if (!existsSync(REPORT)) {
  console.error(`${REPORT} がありません。先に pnpm run test:mutation を実行してください`);
  process.exit(1);
}

const base = git("merge-base", "main", "HEAD").trim();
const changed = changedLines(git("diff", "--unified=0", base));
// 新しいファイルは差分に出ないので、すべての行を変えた行とみなす。
for (const file of git("ls-files", "--others", "--exclude-standard").split("\n")) {
  if (file === "" || !existsSync(file)) continue;
  const count = readFileSync(file, "utf8").split("\n").length;
  changed.set(file, new Set(Array.from({ length: count }, (_, i) => i + 1)));
}

const missed = survivorsOnChangedLines(JSON.parse(readFileSync(REPORT, "utf8")), changed);
console.log("変えた行で、テストが見逃した変異:");
console.log(
  missed.length > 0
    ? missed.map((m) => `  ${m.file}:${m.line} ${m.mutator}（${m.status}）`).join("\n")
    : "  なし",
);
