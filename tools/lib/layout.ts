/**
 * ディレクトリごとに、相対パスで読んでよいディレクトリ（ADR 14）。表にないディレクトリ（test/ など）は見ない。
 * ディレクトリを足したら、検査の設定も手で合わせる（ADR 17）：tsconfig.json の include（または自分の tsconfig.json と
 * package.json の typecheck）・knip.jsonc の project・package.json の網羅率（test）と重複（lint:duplicate）の対象・
 * stryker.config.json の mutate。入口のファイル（bin と cli/ の直下）は mutate に、bin は網羅率にも入れない。検査の道具（tools）は mutate に入れない（ADR 18）。
 */
export const ALLOWED_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  core: ["core"],
  cli: ["core", "cli"],
  functions: ["core", "functions"],
  infra: ["core", "infra"],
  "admin-ui": ["core", "admin-ui"],
  bin: ["core", "infra"],
  tools: ["tools"],
};

/** コードのディレクトリ。一覧はここだけに書く（ADR 16）。 */
export const CODE_DIRS: readonly string[] = [...Object.keys(ALLOWED_IMPORTS), "test"];

/** git が追跡する .ts のある直下のディレクトリのうち、CODE_DIRS にないもの。表にないと、依存の向きが検査されない（ADR 17）。 */
export function findUnlistedDirs(tracked: readonly string[]): string[] {
  const known = new Set(CODE_DIRS);
  const dirs = tracked
    .filter((file) => file.includes("/") && file.endsWith(".ts"))
    .map((file) => file.slice(0, file.indexOf("/")));
  return [...new Set(dirs)].filter((dir) => !known.has(dir));
}
