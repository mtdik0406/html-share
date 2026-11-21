import { changedFiles } from "./changed-files.js";
import { guardedFiles, reviewScope } from "./lib/review-scope.js";

const { branchDiff, uncommitted, untracked } = changedFiles();
const changed = [...branchDiff, ...uncommitted, ...untracked];
const guarded = [...new Set(guardedFiles(changed))].sort();

console.log("範囲:");
for (const file of reviewScope(branchDiff, uncommitted, untracked)) console.log(`  ${file}`);
console.log("ユーザーの判断が要る変更（検査・規則・設計の判断）:");
console.log(guarded.length > 0 ? guarded.map((f) => `  ${f}`).join("\n") : "  なし");
