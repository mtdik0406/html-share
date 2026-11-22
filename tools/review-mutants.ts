import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { changedFiles, mergeBase, parseScopeArgs } from "./changed-files.js";
import { changedLines, survivorsOnChangedLines, wholeFiles } from "./lib/review-scope.js";

const REPORT = "reports/mutation/mutation.json";
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
const readAll = (files: string[]) =>
  wholeFiles(Object.fromEntries(files.map((f) => [f, readFileSync(f, "utf8")])));

if (!existsSync(REPORT)) {
  console.error(`${REPORT} がありません。先に pnpm run test:mutation を実行してください`);
  process.exit(1);
}

// ファイルを指定したら、その全体を見る（変えた行に限らず、ファイルの見逃しを一覧にしたいとき）。
// 指定がなければ、基点（--base、既定は main）から変えた行と新しいファイルを見る。
const { base, positionals: targets } = parseScopeArgs();
let lines: Map<string, Set<number>>;
if (targets.length > 0) {
  lines = readAll(targets);
} else {
  // quotePath を切らないと、日本語などの名前が引用符付きになり、変えた行を拾えない。
  lines = changedLines(git("-c", "core.quotePath=false", "diff", "--unified=0", mergeBase(base)));
  for (const [file, set] of readAll(changedFiles(base).untracked.filter((f) => existsSync(f)))) {
    lines.set(file, set);
  }
}

const missed = survivorsOnChangedLines(JSON.parse(readFileSync(REPORT, "utf8")), lines);
console.log("テストが見逃した変異:");
console.log(
  missed.length > 0
    ? missed.map((m) => `  ${m.file}:${m.line} ${m.mutator}（${m.status}）`).join("\n")
    : "  なし",
);
process.exitCode = missed.length > 0 ? 1 : 0;
