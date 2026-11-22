import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CODE_DIRS } from "./lib/layout.js";
import { countChangedLines, toPathspecs } from "./lib/review-scope.js";

const git = (...args: string[]) => gitIn(undefined, ...args);
const gitIn = (cwd: string | undefined, ...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", cwd });
// -z で NUL 区切りにする。名前に日本語・引用符・tab を含むと、git が引用符付きの形で返し、ファイルを開けなくなるため。
// -z はサブコマンドの直後に置く。-- の後ろに置くと、pathspec として扱われる。
const names = (command: string, ...args: string[]) => namesIn(undefined, command, ...args);
const namesIn = (cwd: string | undefined, command: string, ...args: string[]) =>
  gitIn(cwd, command, "-z", ...args)
    .split("\0")
    .filter((name) => name !== "");

/** 入口のスクリプトの共通の引数。--base は差分の基点（親のブランチに重ねたブランチでは、親を渡す）。 */
export function parseScopeArgs(options: { all?: boolean } = {}): {
  base: string;
  all: boolean;
  positionals: string[];
} {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      base: { type: "string", default: "main" },
      ...(options.all ? { all: { type: "boolean", default: false } } : {}),
    },
  });
  return { base: values.base as string, all: values.all === true, positionals };
}

export function mergeBase(base: string): string {
  return git("merge-base", base, "HEAD").trim();
}

/** 基点から変えたファイル。コミットしていない変更と、git にまだ伝えていない新しいファイルも含める。 */
export function changedFiles(base: string): {
  branchDiff: string[];
  uncommitted: string[];
  untracked: string[];
} {
  return {
    branchDiff: names("diff", "--name-only", mergeBase(base), "HEAD"),
    uncommitted: names("diff", "--name-only", "HEAD"),
    untracked: names("ls-files", "--others", "--exclude-standard"),
  };
}

/** Stryker の mutate の glob に当たる、git が知っているファイルと新しいファイル。cwd はテストで一時のリポジトリを指すため。 */
export function filesMatching(globs: readonly string[], cwd?: string): string[] {
  const specs = toPathspecs(globs);
  return [
    ...namesIn(cwd, "ls-files", "--", ...specs),
    ...namesIn(cwd, "ls-files", "--others", "--exclude-standard", "--", ...specs),
  ];
}

/** 基点から足した行と消した行の数（コードのディレクトリだけ）。新しいファイルは全体を数える。 */
export function changedCodeLines(base: string): number {
  const numstat = git("diff", "--numstat", mergeBase(base), "--", ...CODE_DIRS);
  // ディレクトリや FIFO を読むと落ちるか止まるので、通常のファイルだけを読む。
  const newFiles = names("ls-files", "--others", "--exclude-standard", "--", ...CODE_DIRS)
    .filter((file) => lstatSync(file).isFile())
    .map((file) => readFileSync(file, "utf8"));
  return countChangedLines(numstat, newFiles);
}
