import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { changedFiles, filesMatching } from "./changed-files.js";
import { mutationTargets } from "./lib/review-scope.js";

// 手元で変えた所だけを流す。全体は CI が毎回流す（ADR 11）。
const { mutate } = JSON.parse(readFileSync("stryker.config.json", "utf8")) as { mutate: string[] };
const { branchDiff, uncommitted, untracked } = changedFiles();
const targets = mutationTargets(
  [...new Set([...branchDiff, ...uncommitted, ...untracked])],
  filesMatching(mutate),
);

if (targets.length === 0) {
  console.log("変異テストの対象になる変更はありません");
} else {
  console.log(`変異テストの対象: ${targets.join(", ")}`);
  // incremental はここでだけ使う。CI の全体の実行が、残っていた結果を使い回さないため（ADR 11）。
  const run = spawnSync(
    "pnpm",
    ["exec", "stryker", "run", "--incremental", "--mutate", targets.join(",")],
    { stdio: "inherit" },
  );
  process.exitCode = run.status ?? 1;
}
