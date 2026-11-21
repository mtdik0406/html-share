import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
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

/** pathspec（`:(glob)` 付き）に当たる、git が知っているファイルと新しいファイル。 */
export function filesMatching(globs: readonly string[]): string[] {
  const specs = globs.map((glob) => `:(glob)${glob}`);
  return [
    ...lines("ls-files", "--", ...specs),
    ...lines("ls-files", "--others", "--exclude-standard", "--", ...specs),
  ];
}

const CODE_DIRS = ["scripts", "lib", "bin", "tools", "test"];

/** main から足した行と消した行の数（コードのディレクトリだけ）。新しいファイルは全体を数える。 */
export function changedCodeLines(): number {
  const numstat = lines("diff", "--numstat", git("merge-base", "main", "HEAD"), "--", ...CODE_DIRS);
  const tracked = numstat.reduce((sum, line) => {
    const [added, deleted] = line.split("\t");
    // バイナリのファイルは "-" になるので数えない。
    return sum + (Number(added) || 0) + (Number(deleted) || 0);
  }, 0);
  const untracked = lines("ls-files", "--others", "--exclude-standard", "--", ...CODE_DIRS).reduce(
    (sum, file) => sum + readFileSync(file, "utf8").split("\n").length,
    0,
  );
  return tracked + untracked;
}
