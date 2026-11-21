import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { changedLines, survivorsOnChangedLines, wholeFiles } from "./lib/review-scope.js";

const REPORT = "reports/mutation/mutation.json";
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
const readAll = (files: string[]) =>
  wholeFiles(Object.fromEntries(files.map((f) => [f, readFileSync(f, "utf8")])));

if (!existsSync(REPORT)) {
  console.error(`${REPORT} がありません。先に pnpm run test:mutation を実行してください`);
  process.exit(1);
}

// ファイルを指定したら、その全体を見る（変える前に、今のテストが足りているかを確かめるとき）。
// 指定がなければ、main から変えた行と新しいファイルを見る。
const targets = process.argv.slice(2);
let lines: Map<string, Set<number>>;
if (targets.length > 0) {
  lines = readAll(targets);
} else {
  lines = changedLines(git("diff", "--unified=0", git("merge-base", "main", "HEAD").trim()));
  const untracked = git("ls-files", "--others", "--exclude-standard")
    .split("\n")
    .filter((f) => f !== "" && existsSync(f));
  for (const [file, set] of readAll(untracked)) lines.set(file, set);
}

const missed = survivorsOnChangedLines(JSON.parse(readFileSync(REPORT, "utf8")), lines);
console.log("テストが見逃した変異:");
console.log(
  missed.length > 0
    ? missed.map((m) => `  ${m.file}:${m.line} ${m.mutator}（${m.status}）`).join("\n")
    : "  なし",
);
process.exitCode = missed.length > 0 ? 1 : 0;
