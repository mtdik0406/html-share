import { execFileSync } from "node:child_process";
import { guardedFiles, reviewScope } from "./lib/review-scope.js";

const lines = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .filter((line) => line !== "");

const branchDiff = lines("diff", "--name-only", "main...HEAD");
const uncommitted = lines("diff", "--name-only", "HEAD");
const untracked = lines("ls-files", "--others", "--exclude-standard");
const changed = [...branchDiff, ...uncommitted, ...untracked];
const guarded = [...new Set(guardedFiles(changed))].sort();

console.log("範囲:");
for (const file of reviewScope(branchDiff, uncommitted, untracked)) console.log(`  ${file}`);
console.log("ユーザーの判断が要る変更（検査・規則・設計の判断）:");
console.log(guarded.length > 0 ? guarded.map((f) => `  ${f}`).join("\n") : "  なし");
