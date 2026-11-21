export type RedJudgement = "red" | "passed" | "wrong-reason";

// アサーションの失敗のほかに出たら、まだ実装していないからではなく、テストか仮の実装の誤りで落ちている。
const OTHER_FAILURES =
  /ERR_MODULE_NOT_FOUND|SyntaxError|TypeError|ReferenceError|does not provide an export/;

export function judgeRed(exitCode: number, output: string): RedJudgement {
  if (exitCode === 0) return "passed";
  return output.includes("ERR_ASSERTION") && !OTHER_FAILURES.test(output) ? "red" : "wrong-reason";
}
