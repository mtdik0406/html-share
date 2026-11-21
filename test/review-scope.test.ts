import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  changedLines,
  guardedFiles,
  reviewScope,
  survivorsOnChangedLines,
  wholeFiles,
} from "../tools/lib/review-scope.js";

describe("reviewScope", () => {
  it("ブランチの差分と、未コミットの変更と、新しいファイルを合わせ、重ねない", () => {
    assert.deepEqual(reviewScope(["b.ts", "a.ts"], ["b.ts"], ["c.ts"]), ["a.ts", "b.ts", "c.ts"]);
  });

  it("差分がなければ、コードの全体にする", () => {
    assert.deepEqual(reviewScope([], [], []), ["scripts/", "lib/", "bin/", "tools/", "test/"]);
  });
});

describe("guardedFiles", () => {
  for (const file of [
    "biome.json",
    "knip.jsonc",
    "stryker.config.json",
    "package.json",
    ".github/workflows/check.yml",
    ".claude/settings.json",
    ".claude/hooks/format.sh",
    "tools/check-repo.ts",
    "AGENTS.md",
    "docs/adr/0001-embed-assets-as-data-uri.md",
  ]) {
    it(`${file} は、検査・規則・設計の判断の変更として拾う`, () => {
      assert.deepEqual(guardedFiles([file]), [file]);
    });
  }

  for (const file of ["scripts/lib/embed.ts", "test/embed.test.ts", "README.md", "CLAUDE.md.bak"]) {
    it(`${file} は拾わない`, () => {
      assert.deepEqual(guardedFiles([file]), []);
    });
  }
});

describe(".claude/settings.json", () => {
  const permissions = JSON.parse(readFileSync(".claude/settings.json", "utf8")).permissions;

  it("確認を求めるのは、外へ出る操作と本番を変える操作だけ（ほかは自律して進める）", () => {
    assert.deepEqual([...permissions.ask].sort(), [
      "Bash(aws *)",
      "Bash(git push *)",
      "Bash(pnpm exec cdk deploy *)",
      "Bash(pnpm run sync *)",
    ]);
  });

  for (const rule of ["Read(/.keys/**)", "Bash(pnpm exec cdk destroy *)", "Bash(cdk destroy *)"]) {
    it(`${rule} は禁止する（秘密鍵を出力に出さない、元に戻せない削除をしない）`, () => {
      assert.ok((permissions.deny ?? []).includes(rule));
    });
  }
});

describe("changedLines", () => {
  it("差分の追加の行の番号を、ファイルごとに返す", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,0 +2,2 @@",
      "+x",
      "+y",
      "@@ -9 +10 @@",
      "-old",
      "+new",
      "@@ -20,0 +30,12 @@ function f() {",
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-z",
    ].join("\n");
    const tail = Array.from({ length: 12 }, (_, i) => 30 + i);
    assert.deepEqual(changedLines(diff), new Map([["a.ts", new Set([2, 3, 10, ...tail])]]));
  });
});

describe("survivorsOnChangedLines", () => {
  const report = {
    files: {
      "a.ts": {
        mutants: [
          {
            status: "Survived",
            mutatorName: "ConditionalExpression",
            location: { start: { line: 2 } },
          },
          {
            status: "Killed",
            mutatorName: "ConditionalExpression",
            location: { start: { line: 3 } },
          },
          { status: "NoCoverage", mutatorName: "BlockStatement", location: { start: { line: 3 } } },
          { status: "Survived", mutatorName: "StringLiteral", location: { start: { line: 50 } } },
        ],
      },
      "b.ts": {
        mutants: [{ status: "Survived", mutatorName: "Regex", location: { start: { line: 2 } } }],
      },
    },
  };

  it("変えた行で、テストが見逃した変異（生き残り・未到達）だけを返す", () => {
    assert.deepEqual(survivorsOnChangedLines(report, new Map([["a.ts", new Set([2, 3])]])), [
      { file: "a.ts", line: 2, mutator: "ConditionalExpression", status: "Survived" },
      { file: "a.ts", line: 3, mutator: "BlockStatement", status: "NoCoverage" },
    ]);
  });
});

describe("wholeFiles", () => {
  it("指定したファイルの、すべての行を変えた行とみなす", () => {
    assert.deepEqual(wholeFiles({ "a.ts": "x\ny\nz" }), new Map([["a.ts", new Set([1, 2, 3])]]));
  });
});
