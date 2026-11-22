import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CODE_DIRS, findLayoutGaps, type LayoutInput } from "../../../tools/lib/layout.js";

const covered: LayoutInput = {
  dirsWithTs: ["admin-ui", "bin", "cli", "core", "functions", "infra", "test", "tools"],
  dirsWithTsconfig: ["admin-ui"],
  tsconfigInclude: [
    "bin/**/*.ts",
    "cli/**/*.ts",
    "core/**/*.ts",
    "functions/**/*.ts",
    "infra/**/*.ts",
    "test/**/*.ts",
    "tools/**/*.ts",
  ],
  knipProject: [
    "admin-ui/**/*.ts",
    "bin/**/*.ts",
    "cli/**/*.ts",
    "core/**/*.ts",
    "functions/**/*.ts",
    "infra/**/*.ts",
    "tools/**/*.ts",
    "test/**/*.ts",
  ],
  strykerMutate: [
    "admin-ui/**/*.ts",
    "cli/lib/**/*.ts",
    "core/**/*.ts",
    "functions/**/*.ts",
    "infra/**/*.ts",
    "tools/lib/**/*.ts",
  ],
  testScript: [
    "tsx --test --experimental-test-coverage",
    ...["admin-ui", "cli", "core", "functions", "infra", "tools"].map(
      (d) => `--test-coverage-include="${d}/**"`,
    ),
    '"test/**/*.test.ts"',
  ].join(" "),
  duplicateScript:
    "jscpd --exit-code --reporters console admin-ui bin cli core functions infra tools test",
};

const gaps = (input: Partial<LayoutInput>) => findLayoutGaps({ ...covered, ...input });
const without = (list: readonly string[], dir: string) =>
  list.filter((glob) => !glob.startsWith(`${dir}/`));

describe("findLayoutGaps", () => {
  it("どのディレクトリも検査の対象に入っていれば、何も見つけない", () => {
    assert.deepEqual(gaps({}), []);
  });

  it("コードのディレクトリの一覧は、依存の向きの表のディレクトリと test", () => {
    assert.deepEqual([...CODE_DIRS].sort(), [
      "admin-ui",
      "bin",
      "cli",
      "core",
      "functions",
      "infra",
      "test",
      "tools",
    ]);
  });

  it(".ts があるのに、依存の向きの表にないディレクトリを見つける", () => {
    assert.deepEqual(gaps({ dirsWithTs: [...covered.dirsWithTs, "shared"] }), [
      { dir: "shared", check: "imports" },
    ]);
  });

  it("tsconfig.json の include になく、自分の tsconfig.json も持たないディレクトリを見つける", () => {
    assert.deepEqual(gaps({ tsconfigInclude: without(covered.tsconfigInclude, "core") }), [
      { dir: "core", check: "tsconfig" },
    ]);
    assert.deepEqual(gaps({ dirsWithTsconfig: [] }), [{ dir: "admin-ui", check: "tsconfig" }]);
  });

  it("knip と jscpd の対象にないディレクトリを見つける（test を含む）", () => {
    assert.deepEqual(gaps({ knipProject: without(covered.knipProject, "test") }), [
      { dir: "test", check: "knip" },
    ]);
    assert.deepEqual(gaps({ duplicateScript: covered.duplicateScript.replace(" infra ", " ") }), [
      { dir: "infra", check: "jscpd" },
    ]);
  });

  it("ソースのディレクトリが、網羅率と変異テストの対象になければ見つける", () => {
    assert.deepEqual(gaps({ strykerMutate: without(covered.strykerMutate, "functions") }), [
      { dir: "functions", check: "mutate" },
    ]);
    assert.deepEqual(
      gaps({ testScript: covered.testScript.replace('--test-coverage-include="cli/**"', "") }),
      [{ dir: "cli", check: "coverage" }],
    );
  });

  it("入口だけの bin と、テストの test は、網羅率と変異テストの対象にしなくてよい", () => {
    assert.deepEqual(gaps({ dirsWithTs: [...covered.dirsWithTs] }), []);
    assert.ok(!covered.strykerMutate.some((g) => g.startsWith("bin/") || g.startsWith("test/")));
  });

  it("名前の先頭だけが同じディレクトリは、対象に入っているとみなさない", () => {
    assert.deepEqual(
      gaps({
        tsconfigInclude: [...without(covered.tsconfigInclude, "core"), "core-old/**/*.ts"],
      }),
      [{ dir: "core", check: "tsconfig" }],
    );
    assert.deepEqual(
      gaps({ duplicateScript: covered.duplicateScript.replace(" core ", " core-old ") }),
      [{ dir: "core", check: "jscpd" }],
    );
  });
});
