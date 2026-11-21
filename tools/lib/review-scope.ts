/** 差分がないときに見る範囲。 */
const WHOLE_CODEBASE = ["scripts/", "lib/", "bin/", "tools/", "test/"];

/**
 * 変えるにはユーザーの判断が要るファイル。検査の設定と検査そのもの、作業の規則、設計の判断。
 * 末尾が / のものはディレクトリ。
 */
const GUARDED_PATHS: readonly string[] = [
  "biome.json",
  "knip.jsonc",
  "stryker.config.json",
  "tsconfig.json",
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
