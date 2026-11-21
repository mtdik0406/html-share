import { changedCodeLines, changedFiles, parseScopeArgs } from "./changed-files.js";
import { guardedFiles, reviewerCount, reviewScope } from "./lib/review-scope.js";

const { base } = parseScopeArgs();
const { branchDiff, uncommitted, untracked } = changedFiles(base);
const changed = [...branchDiff, ...uncommitted, ...untracked];
const guarded = [...new Set(guardedFiles(changed))].sort();

console.log(`範囲（${base} から）:`);
for (const file of reviewScope(branchDiff, uncommitted, untracked)) console.log(`  ${file}`);
console.log("ユーザーの判断が要る変更（検査・規則・設計の判断）:");
console.log(guarded.length > 0 ? guarded.map((f) => `  ${f}`).join("\n") : "  なし");
const codeLines = changedCodeLines(base);
console.log(
  `コードの差分: ${codeLines} 行（レビューのエージェント: ${reviewerCount(codeLines)} 体）`,
);
