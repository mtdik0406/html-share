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
  /** package.json の test・lint:duplicate・typecheck の script。 */
  testScript: string;
  duplicateScript: string;
  typecheckScript: string;
}

export interface LayoutConfigs {
  tsconfig: { include?: readonly string[] };
  knip: { project?: readonly string[] };
  stryker: { mutate?: readonly string[] };
  scripts: Readonly<Record<string, string | undefined>>;
}

/** git が追跡するファイルの一覧と設定の値から、突き合わせの入力を作る。設定の値がなければ、空として漏れに数える。 */
export function layoutInput(tracked: readonly string[], configs: LayoutConfigs): LayoutInput {
  const topDir = (file: string) => file.slice(0, file.indexOf("/"));
  return {
    dirsWithTs: [
      ...new Set(tracked.filter((f) => f.includes("/") && f.endsWith(".ts")).map(topDir)),
    ],
    dirsWithTsconfig: tracked
      .filter((f) => f.endsWith("/tsconfig.json") && f.indexOf("/") === f.lastIndexOf("/"))
      .map(topDir),
    tsconfigInclude: configs.tsconfig.include ?? [],
    knipProject: configs.knip.project ?? [],
    strykerMutate: configs.stryker.mutate ?? [],
    testScript: configs.scripts.test ?? "",
    duplicateScript: configs.scripts["lint:duplicate"] ?? "",
    typecheckScript: configs.scripts.typecheck ?? "",
  };
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
  // 自分の tsconfig.json は、typecheck が -p で渡したときだけ使われる。
  // Stryker disable next-line Regex: 空白が続くと空の語が増えるだけで、-p の次の語は同じ
  const typecheck = input.typecheckScript.split(/\s+/);
  const projects = new Set(
    // Stryker disable next-line ConditionalExpression,EqualityOperator: 先頭の語の前は undefined で、-p にも --project にも当たらない
    typecheck.filter((_, i) => i > 0 && ["-p", "--project"].includes(typecheck[i - 1] as string)),
  );
  for (const dir of CODE_DIRS) {
    const sourceDir = dir !== "test" && !ENTRY_ONLY_DIRS.has(dir);
    const covered: Record<LayoutCheck, boolean> = {
      imports: true,
      tsconfig:
        input.tsconfigInclude.some(underDir(dir)) ||
        (input.dirsWithTsconfig.includes(dir) && projects.has(dir)),
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
