/** ディレクトリごとに、相対パスで読んでよいディレクトリ（ADR 14）。表にないディレクトリ（test/ など）は見ない。 */
export const ALLOWED_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  core: ["core"],
  cli: ["core", "cli"],
  functions: ["core", "functions"],
  infra: ["core", "infra"],
  "admin-ui": ["core", "admin-ui"],
  bin: ["core", "infra"],
  tools: ["tools"],
};

/** コードのディレクトリ。ディレクトリの一覧はここだけに書き、検査の設定との食い違いは findLayoutGaps で見つける（ADR 16）。 */
export const CODE_DIRS: readonly string[] = [...Object.keys(ALLOWED_IMPORTS), "test"];

/** 入口だけを置き、テストから読まないので、網羅率と変異テストの対象にしないディレクトリ。 */
const ENTRY_ONLY_DIRS = new Set(["bin"]);

type LayoutCheck = "imports" | "tsconfig" | "knip" | "jscpd" | "coverage" | "mutate";

export interface LayoutGap {
  dir: string;
  check: LayoutCheck;
}

export interface LayoutInput {
  /** git が追跡する .ts のある、リポジトリの直下のディレクトリ。 */
  dirsWithTs: readonly string[];
  /** 自分の tsconfig.json を持つ、直下のディレクトリ。 */
  dirsWithTsconfig: readonly string[];
  tsconfigInclude: readonly string[];
  knipProject: readonly string[];
  strykerMutate: readonly string[];
  /** package.json の test と lint:duplicate の script。 */
  testScript: string;
  duplicateScript: string;
}

/** 検査の設定が、コードのディレクトリを漏れなく対象にしているか。足し忘れても、どの検査も落ちないため。 */
export function findLayoutGaps(input: LayoutInput): LayoutGap[] {
  const gaps: LayoutGap[] = [];
  const known = new Set(CODE_DIRS);
  for (const dir of input.dirsWithTs) {
    if (!known.has(dir)) gaps.push({ dir, check: "imports" });
  }
  const underDir = (dir: string) => (glob: string) => glob.startsWith(`${dir}/`);
  const coverage = [...input.testScript.matchAll(/--test-coverage-include="([^"]+)"/g)].map(
    ([, glob]) => glob as string,
  );
  // Stryker disable next-line Regex: 空白が続くと空の語が増えるだけで、ディレクトリの名前の有無は同じ
  const duplicate = new Set(input.duplicateScript.split(/\s+/));
  for (const dir of CODE_DIRS) {
    const sourceDir = dir !== "test" && !ENTRY_ONLY_DIRS.has(dir);
    const covered: Record<LayoutCheck, boolean> = {
      imports: true,
      tsconfig: input.tsconfigInclude.some(underDir(dir)) || input.dirsWithTsconfig.includes(dir),
      knip: input.knipProject.some(underDir(dir)),
      jscpd: duplicate.has(dir),
      coverage: !sourceDir || coverage.some(underDir(dir)),
      mutate: !sourceDir || input.strykerMutate.some(underDir(dir)),
    };
    for (const [check, ok] of Object.entries(covered)) {
      if (!ok) gaps.push({ dir, check: check as LayoutCheck });
    }
  }
  return gaps;
}
