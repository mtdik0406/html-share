import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { changedFiles, filesMatching, parseScopeArgs } from "./changed-files.js";
import { mutationPlan } from "./lib/review-scope.js";

// 手元で変えた所だけを流す。全体は main への push の CI が流す（ADR 11・18・19）。
// incremental はここでだけ使う。CI の全体の実行が、残っていた結果を使い回さないため。
const { base, all } = parseScopeArgs({ all: true });
const { mutate } = JSON.parse(readFileSync("stryker.config.json", "utf8")) as { mutate: string[] };
const { branchDiff, uncommitted, untracked } = changedFiles(base);
const plan = all
  ? ({ all: true } as const)
  : mutationPlan(
      [...new Set([...branchDiff, ...uncommitted, ...untracked])],
      filesMatching(mutate),
      filesMatching(["**/*.ts"]),
    );

const stryker = (...args: string[]) =>
  spawnSync("pnpm", ["exec", "stryker", "run", "--incremental", ...args], { stdio: "inherit" })
    .status ?? 1;

if (plan.all) {
  // どのソースに効くか分からない変更なので、前回の結果を使わずに全体を流し、結果を作り直す。
  console.log("全体を流し、前回の結果を作り直します");
  process.exitCode = stryker("--force");
} else if (plan.files.length === 0) {
  console.log("変異テストの対象になる変更はありません");
} else {
  console.log(`変異テストの対象: ${plan.files.join(", ")}`);
  process.exitCode = stryker("--mutate", plan.files.join(","));
}
