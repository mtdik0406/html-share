/** 差分がないときに見る範囲。 */
const WHOLE_CODEBASE = ["scripts/", "lib/", "bin/", "tools/", "test/"];

/**
 * 変えるにはユーザーの判断が要るファイル。検査の設定と検査そのもの、作業の規則、設計の判断。
 * 末尾が / のものはディレクトリ。
 */
export const GUARDED_PATHS: readonly string[] = [
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
