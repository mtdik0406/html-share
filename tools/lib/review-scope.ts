/** 差分がないときに見る範囲。 */
export const CODE_DIRS = ["core", "cli", "functions", "infra", "admin-ui", "bin", "tools", "test"];
const WHOLE_CODEBASE = CODE_DIRS.map((dir) => `${dir}/`);

/**
 * 変えるにはユーザーの判断が要るファイル。検査の設定と検査そのもの、作業の規則、設計の判断。
 * 末尾が / のものはディレクトリ。
 */
const GUARDED_PATHS: readonly string[] = [
  "biome.json",
  "knip.jsonc",
  "stryker.config.json",
  "tsconfig.json",
  "admin-ui/tsconfig.json",
  "package.json",
  "pnpm-workspace.yaml",
  ".nvmrc",
  ".githooks/",
  ".github/",
  ".claude/settings.json",
  ".claude/hooks/",
  ".claude/skills/",
  "tools/",
  "AGENTS.md",
  "CLAUDE.md",
  "docs/adr/",
];

export function reviewScope(
  branchDiff: readonly string[],
  uncommitted: readonly string[],
  untracked: readonly string[],
): string[] {
  const files = [...new Set([...branchDiff, ...uncommitted, ...untracked])].sort();
  return files.length > 0 ? files : WHOLE_CODEBASE;
}

export function guardedFiles(files: readonly string[]): string[] {
  return files.filter((file) =>
    GUARDED_PATHS.some((path) => (path.endsWith("/") ? file.startsWith(path) : file === path)),
  );
}

/** `git diff --unified=0` の出力から、変えた後のファイルで追加された行の番号を拾う。 */
export function changedLines(diff: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  let lines: Set<number> | undefined;
  for (const line of diff.split("\n")) {
    // Stryker disable next-line Regex: diff の行は +・-・空白・@ で始まるので、^ と $ の有無で結果は変わらない
    const file = /^\+\+\+ b\/(.+)$/.exec(line);
    if (file) {
      lines = new Set();
      result.set(file[1] as string, lines);
      continue;
    }
    // Stryker disable next-line Regex: hunk の見出しは行頭にしか出ないので、^ の有無で結果は変わらない
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && lines) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let n = start; n < start + count; n++) lines.add(n);
    }
  }
  return result;
}

interface MutationReport {
  files: Record<
    string,
    { mutants: { status: string; mutatorName: string; location: { start: { line: number } } }[] }
  >;
}

const MISSED = new Set(["Survived", "NoCoverage"]);

export function survivorsOnChangedLines(
  report: MutationReport,
  changed: Map<string, Set<number>>,
): { file: string; line: number; mutator: string; status: string }[] {
  return Object.entries(report.files).flatMap(([file, { mutants }]) =>
    mutants
      .filter((m) => MISSED.has(m.status) && changed.get(file)?.has(m.location.start.line))
      .map((m) => ({
        file,
        line: m.location.start.line,
        mutator: m.mutatorName,
        status: m.status,
      })),
  );
}

export function wholeFiles(contents: Record<string, string>): Map<string, Set<number>> {
  return new Map(
    Object.entries(contents).map(([file, text]) => [
      file,
      new Set(Array.from({ length: text.split("\n").length }, (_, i) => i + 1)),
    ]),
  );
}

/** 変えると、どのソースの変異の結果も変わりうるファイル。 */
const AFFECTS_ALL_MUTANTS = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "stryker.config.json",
  "tsconfig.json",
  // 管理画面をまとめる esbuild が読む。
  "admin-ui/tsconfig.json",
  "tools/stryker-message-ignorer.js",
]);

export type MutationPlan = { all: true } | { all: false; files: string[] };

/**
 * 変異テストを流す範囲。変えたソースと、変えたテストに対応するソース（test/<パス>.test.ts は <パス>.ts のテスト、ADR 14）。
 * 対応するソースのないテスト（helper を含む）や依存・設定を変えたら、どのソースに効くか分からないので全体にする。
 * sources は、変異の対象のファイルの一覧（stryker.config.json の mutate に当たるもの）。
 */
export function mutationPlan(changed: readonly string[], sources: readonly string[]): MutationPlan {
  const sourceSet = new Set(sources);
  const tested = new Set<string>();
  for (const file of changed) {
    if (AFFECTS_ALL_MUTANTS.has(file)) return { all: true };
    if (!file.startsWith("test/")) continue;
    // Stryker disable next-line Regex: test/ で始まることは上で確かめているので、^ の有無で結果は同じ
    const path = /^test\/(.+)\.test\.ts$/.exec(file)?.[1];
    // Stryker disable next-line ConditionalExpression: path がないと "undefined.ts" を探して見つからず、結果は同じ
    if (path === undefined || !sourceSet.has(`${path}.ts`)) return { all: true };
    tested.add(`${path}.ts`);
  }
  const files = sources.filter((source) => changed.includes(source) || tested.has(source)).sort();
  return { all: false, files };
}

/** レビューのエージェントの数。差分が小さいほど、観点を 1 体にまとめてもレビューの質が落ちにくい。 */
export function reviewerCount(changedCodeLines: number): 1 | 2 | 4 {
  if (changedCodeLines < 300) return 1;
  return changedCodeLines < 1000 ? 2 : 4;
}

/** `git diff --numstat` の出力と、新しいファイルの中身から、足した行と消した行の数を出す。 */
export function countChangedLines(numstat: string, newFiles: readonly string[]): number {
  // バイナリのファイルは数の代わりに "-" になるので、当たらない。
  // Stryker disable next-line Regex: git は tab を含む名前を引用符で囲むので、^ の有無で当たる行は同じ
  const tracked = [...numstat.matchAll(/^(\d+)\t(\d+)\t/gm)].reduce(
    (sum, [, added, deleted]) => sum + Number(added) + Number(deleted),
    0,
  );
  // 末尾の改行のあとは行に数えない。
  const untracked = newFiles.reduce(
    (sum, text) => sum + text.split("\n").length - (text.endsWith("\n") || text === "" ? 1 : 0),
    0,
  );
  return tracked + untracked;
}

/** Stryker の mutate の glob を、git の pathspec にする。`!` で始まるものは除外にする。 */
export function toPathspecs(globs: readonly string[]): string[] {
  return globs.map((glob) =>
    glob.startsWith("!") ? `:(exclude,glob)${glob.slice(1)}` : `:(glob)${glob}`,
  );
}
