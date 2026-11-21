import { execFileSync } from "node:child_process";

const lines = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" })
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

/** pathspec（`:(glob)` 付き）に当たる、git が知っているファイルと新しいファイル。 */
export function filesMatching(globs: readonly string[]): string[] {
  const specs = globs.map((glob) => `:(glob)${glob}`);
  return [
    ...lines("ls-files", "--", ...specs),
    ...lines("ls-files", "--others", "--exclude-standard", "--", ...specs),
  ];
}
