import { spawnSync } from "node:child_process";
import { judgeRed } from "./lib/tdd-red.js";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("使い方: pnpm run tdd:red <テストのファイル>...");
  process.exit(1);
}

const run = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  encoding: "utf8",
});
const output = `${run.stdout}${run.stderr}`;
const judgement = judgeRed(run.status ?? 1, output);

const messages = {
  red: "落ちた（アサーションの失敗）。実装に進んでよい",
  passed: "通った。まだ実装していない振る舞いを確かめていない",
  "wrong-reason": "アサーション以外の理由で落ちた。テストか仮の実装を直す",
} as const;
if (judgement !== "red") console.error(output.split("\n").slice(-40).join("\n"));
console.log(messages[judgement]);
process.exitCode = judgement === "red" ? 0 : 1;
