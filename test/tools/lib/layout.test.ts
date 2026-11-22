import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CODE_DIRS,
  findLayoutGaps,
  type LayoutInput,
  layoutInput,
} from "../../../tools/lib/layout.js";

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
  typecheckScript: "tsc --noEmit && tsc --noEmit -p admin-ui",
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

  it("自分の tsconfig.json を持っても、typecheck が -p で流していなければ見つける", () => {
    assert.deepEqual(gaps({ typecheckScript: "tsc --noEmit" }), [
      { dir: "admin-ui", check: "tsconfig" },
    ]);
    assert.deepEqual(gaps({ typecheckScript: "tsc --noEmit -p admin-ui-old admin-ui" }), [
      { dir: "admin-ui", check: "tsconfig" },
    ]);
    assert.deepEqual(gaps({ typecheckScript: "tsc --noEmit --project admin-ui" }), []);
    assert.deepEqual(gaps({ typecheckScript: "tsc --noEmit -p  admin-ui" }), []);
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

  it("入口だけの bin と、テストの test は、網羅率と変異テストの対象にしなくてよいが、ほかの検査からは外せない", () => {
    const testScript = `${covered.testScript} --test-coverage-include="bin/**"`;
    assert.deepEqual(
      gaps({ testScript, strykerMutate: [...covered.strykerMutate, "bin/**/*.ts"] }),
      [],
    );
    assert.deepEqual(gaps({ knipProject: without(covered.knipProject, "bin") }), [
      { dir: "bin", check: "knip" },
    ]);
    assert.deepEqual(gaps({ tsconfigInclude: without(covered.tsconfigInclude, "bin") }), [
      { dir: "bin", check: "tsconfig" },
    ]);
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

describe("layoutInput", () => {
  const configs = {
    tsconfig: { include: ["core/**/*.ts"] },
    knip: { project: ["core/**/*.ts"] },
    stryker: { mutate: ["core/**/*.ts"] },
    scripts: { test: "t", "lint:duplicate": "d", typecheck: "c" },
  };

  it("直下のディレクトリの .ts と tsconfig.json を数え、設定の値をそのまま渡す", () => {
    const input = layoutInput(
      [
        "core/page.ts",
        "core/sub/a.ts",
        "admin-ui/tsconfig.json",
        "admin-ui/api.ts",
        "admin-ui/nested/tsconfig.json",
        "docs/adr/0001.md",
        "top.ts",
        "tools/stryker-message-ignorer.js",
        "docs/old.ts.bak",
        "docs/tsconfig.json.bak",
        "core/sub/tsconfig.json",
      ],
      configs,
    );
    assert.deepEqual([...input.dirsWithTs].sort(), ["admin-ui", "core"]);
    assert.deepEqual(input.dirsWithTsconfig, ["admin-ui"]);
    assert.deepEqual(input.tsconfigInclude, ["core/**/*.ts"]);
    assert.deepEqual(input.knipProject, ["core/**/*.ts"]);
    assert.deepEqual(input.strykerMutate, ["core/**/*.ts"]);
    assert.equal(input.testScript, "t");
    assert.equal(input.duplicateScript, "d");
    assert.equal(input.typecheckScript, "c");
  });

  it("設定の値がなければ、空として扱い、検査の漏れとして見つける", () => {
    const input = layoutInput(["core/page.ts"], {
      tsconfig: {},
      knip: {},
      stryker: {},
      scripts: {},
    });
    assert.deepEqual([input.tsconfigInclude, input.knipProject, input.strykerMutate], [[], [], []]);
    assert.deepEqual(
      [input.testScript, input.duplicateScript, input.typecheckScript],
      ["", "", ""],
    );
    assert.ok(findLayoutGaps(input).some((g) => g.dir === "core" && g.check === "tsconfig"));
  });
});
