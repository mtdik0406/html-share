import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { CODE_DIRS, countChangedLines, toPathspecs } from "./lib/review-scope.js";

// quotePath を切らないと、日本語などの名前が引用符付きの 8 進数で返り、ファイルを開けない。
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "core.quotePath=false", ...args], { encoding: "utf8" }).trim();
const lines = (...args: string[]) =>
  git(...args)
    .split("\n")
    .filter((line) => line !== "");

/** main から変えたファイル。コミットしていない変更と、git にまだ伝えていない新しいファイルも含める。 */
export function changedFiles(): {
  branchDiff: string[];
  uncommitted: string[];
  untracked: string[];
} {
  return {
    branchDiff: lines("diff", "--name-only", "main...HEAD"),
    uncommitted: lines("diff", "--name-only", "HEAD"),
    untracked: lines("ls-files", "--others", "--exclude-standard"),
  };
}

/** Stryker の mutate の glob に当たる、git が知っているファイルと新しいファイル。 */
export function filesMatching(globs: readonly string[]): string[] {
  const specs = toPathspecs(globs);
  return [
    ...lines("ls-files", "--", ...specs),
    ...lines("ls-files", "--others", "--exclude-standard", "--", ...specs),
  ];
}

/** main から足した行と消した行の数（コードのディレクトリだけ）。新しいファイルは全体を数える。 */
export function changedCodeLines(): number {
  const numstat = git("diff", "--numstat", git("merge-base", "main", "HEAD"), "--", ...CODE_DIRS);
  // ディレクトリや FIFO を読むと落ちるか止まるので、通常のファイルだけを読む。
  const newFiles = lines("ls-files", "--others", "--exclude-standard", "--", ...CODE_DIRS)
    .filter((file) => lstatSync(file).isFile())
    .map((file) => readFileSync(file, "utf8"));
  return countChangedLines(numstat, newFiles);
}
