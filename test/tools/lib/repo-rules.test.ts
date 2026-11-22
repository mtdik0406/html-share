import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adrChangedOutsideStatus,
  findForbiddenImports,
  findForbiddenText,
  findMessageAssertions,
  findMissingReferences,
  findPrivateKeyAccess,
} from "../../../tools/lib/repo-rules.js";

describe("findForbiddenText", () => {
  const home = ["", "Users", "someone", "work"].join("/");
  for (const [label, text] of [
    ["macOS のホームの絶対パス", `see ${home}/a.ts`],
    ["Linux のホームの絶対パス", "see /home/someone/a.ts"],
    ["作った経緯の言葉", "学習用のツール"],
    ["段階の番号", "段階 4 で足す"],
    ["空白のない段階の番号", "段階4で足す"],
  ] as const) {
    it(`${label} を見つける`, () => {
      assert.equal(findForbiddenText(text).length, 1);
    });
  }

  for (const [label, text] of [
    ["リポジトリの中の相対パス", "scripts/lib/embed.ts"],
    ["~ で始まるパス", "~/work/pages"],
    ["番号の付かない「段階」", "段階的に移す"],
  ] as const) {
    it(`${label} は通す`, () => {
      assert.deepEqual(findForbiddenText(text), []);
    });
  }

  it("見つけた行の番号を返す", () => {
    assert.deepEqual(
      findForbiddenText("a\nb\n学習用").map((f) => f.line),
      [3],
    );
  });
});

describe("findMessageAssertions", () => {
  for (const [label, source] of [
    ["正規表現", "assert.throws(() => f(), /bad/);"],
    ["文字列", 'await assert.rejects(p, "bad");'],
    ["message を持つオブジェクト", "assert.throws(() => f(), { message: 'bad' });"],
    ["message を読む関数", "assert.throws(() => f(), (e) => e.message === 'bad');"],
    ["ほかのキーと並んだ message", "assert.throws(() => f(), { code: 'E', message: 'bad' });"],
  ] as const) {
    it(`${label}でエラーの文言を見ていれば見つける`, () => {
      assert.equal(findMessageAssertions(source).length, 1);
    });
  }

  for (const [label, source] of [
    ["失敗することだけ", "assert.throws(() => f());"],
    ["エラーの種類", "assert.throws(() => f(), TypeError);"],
    ["文言以外を見る関数", "assert.throws(() => f(), (e) => e.cause instanceof RangeError);"],
    ["文言以外のキーのオブジェクト", "assert.throws(() => f(), { code: 'E' });"],
    ["展開だけのオブジェクト", "assert.throws(() => f(), { ...expected });"],
    ["失敗しないこと", "assert.doesNotThrow(() => f(), /x/);"],
  ] as const) {
    it(`${label}は通す`, () => {
      assert.deepEqual(findMessageAssertions(source), []);
    });
  }

  it("見つけた行の番号を返す", () => {
    assert.deepEqual(
      findMessageAssertions("const a = 1;\nassert.throws(() => f(), /x/);").map((f) => f.line),
      [2],
    );
  });
});

describe("adrChangedOutsideStatus", () => {
  const adr = (status: string, body = "## 決定\n\n- A\n") =>
    `# 1. 題\n\n- 日付：2026-11-21\n- 状態：${status}\n\n${body}`;

  it("状態の行だけを変えたなら通す（置き換えた ADR を書くとき）", () => {
    assert.equal(adrChangedOutsideStatus(adr("採用"), adr("0006 で置き換え")), false);
  });

  it("変えていなければ通す", () => {
    assert.equal(adrChangedOutsideStatus(adr("採用"), adr("採用")), false);
  });

  it("行をつなげただけでも見つける", () => {
    assert.equal(adrChangedOutsideStatus(adr("採用", "A\nB\n"), adr("採用", "AB\n")), true);
  });

  it("状態の行の外を変えたら見つける", () => {
    assert.equal(adrChangedOutsideStatus(adr("採用"), adr("採用", "## 決定\n\n- B\n")), true);
  });
});

describe("findMissingReferences", () => {
  const known = { scripts: new Set(["check", "sync"]), skills: new Set(["develop"]) };

  it("ある script と skill だけを参照していれば通す", () => {
    const text = "`pnpm run check` と `pnpm run sync --dry-run`、`develop` の skill";
    assert.deepEqual(findMissingReferences(text, known), []);
  });

  for (const [label, text] of [
    ["ない script", "`pnpm run gone` を実行する"],
    ["ない skill", "`quality-review` の skill を使う"],
  ] as const) {
    it(`${label}を参照していれば見つける`, () => {
      assert.equal(findMissingReferences(text, known).length, 1);
    });
  }

  it("見つけた行の番号を返す", () => {
    const text = "a\n`pnpm run gone`\n`gone` の skill";
    assert.deepEqual(
      findMissingReferences(text, known).map((f) => f.line),
      [2, 3],
    );
  });
});

describe("findPrivateKeyAccess", () => {
  const code =
    'import { PRIVATE_KEY_PATH } from "../../lib/paths.js";\nreadFile(PRIVATE_KEY_PATH);';

  it("決めた場所の外のコードが、秘密鍵の場所を参照していたら見つける", () => {
    assert.deepEqual(
      findPrivateKeyAccess("cli/sign.ts", code).map((f) => f.line),
      [1, 2],
    );
    assert.equal(findPrivateKeyAccess("functions/sign/index.ts", "PRIVATE_KEY_FILE").length, 1);
  });

  it("鍵を作る所と SSM に置く所は、参照してよい", () => {
    for (const path of [
      "core/paths.ts",
      "cli/lib/keygen.ts",
      "cli/keys-store.ts",
      "test/cli/lib/keygen.test.ts",
    ]) {
      assert.deepEqual(findPrivateKeyAccess(path, code), []);
    }
  });

  it("コードでないファイルと、名前の一部が同じだけの識別子は見ない", () => {
    assert.deepEqual(findPrivateKeyAccess("README.md", code), []);
    assert.deepEqual(findPrivateKeyAccess("cli/sign.ts", "MY_PRIVATE_KEY_PATHS"), []);
  });
});

describe("findForbiddenImports", () => {
  const lines = (path: string, source: string) =>
    findForbiddenImports(path, source).map((f) => f.line);

  for (const [from, spec] of [
    ["core/page.ts", "./lifetime.js"],
    ["cli/lib/sync-run.ts", "../../core/page.js"],
    ["cli/sync.ts", "./lib/cli.js"],
    ["functions/admin-auth/index.ts", "../sign/sign-request.js"],
    ["functions/sign/index.ts", "../../core/names.js"],
    ["infra/admin-console.ts", "./node-function.js"],
    ["infra/admin-console.ts", "../core/admin-config.js"],
    ["admin-ui/index.ts", "../core/lifetime.js"],
    ["bin/app.ts", "../infra/html-share-stack.js"],
    ["bin/app.ts", "../core/paths.js"],
    ["tools/check-repo.ts", "./lib/repo-rules.js"],
  ] as const) {
    it(`${from} は ${spec} を読んでよい`, () => {
      assert.deepEqual(lines(from, `import { x } from "${spec}";`), []);
    });
  }

  for (const [from, spec] of [
    ["core/page.ts", "../cli/lib/config.js"],
    ["core/names.ts", "../infra/names.js"],
    ["cli/lib/sync-run.ts", "../../functions/http.js"],
    ["functions/sign/index.ts", "../../infra/node-function.js"],
    ["infra/admin-console.ts", "../functions/admin-auth/auth-io.js"],
    ["admin-ui/api.ts", "../functions/http.js"],
    ["bin/app.ts", "../cli/lib/cli.js"],
    ["tools/check-repo.ts", "../core/page.js"],
    ["core/page.ts", "../../outside.js"],
  ] as const) {
    it(`${from} が ${spec} を読んだら見つける`, () => {
      assert.deepEqual(lines(from, `import { x } from "${spec}";`), [1]);
    });
  }

  it("型だけの import・export ... from・import() も見る", () => {
    const source = [
      'import type { A } from "../cli/a.js";',
      'import { type B } from "../cli/b.js";',
      'export { C } from "../cli/c.js";',
      'export * from "../cli/d.js";',
      'const e = await import("../cli/e.js");',
      'type F = import("../cli/f.js").F;',
      'let g: typeof import("../cli/g.js");',
      "const h = await import(`../cli/h.js`);",
      'import "./../cli/i.js";',
      'import j from "..";',
    ].join("\n");
    assert.deepEqual(lines("core/page.ts", source), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("読んでよい所なら、どの書き方でも見つけない", () => {
    const source = [
      'import type { A } from "./a.js";',
      'import { type B } from "./b.js";',
      'export { C } from "./c.js";',
      'export * from "./d.js";',
      'const e = await import("./e.js");',
      'type F = import("./f.js").F;',
      "const h = await import(`./h.js`);",
      "export { local };",
    ].join("\n");
    assert.deepEqual(lines("core/page.ts", source), []);
    assert.deepEqual(lines("admin-ui/index.ts", 'import { x } from "./api.js";'), []);
  });

  it("import() でない呼び出しと、相対パスに見えるだけのパッケージの指定は見ない", () => {
    const source = [
      'readFileSync("../cli/a.js");',
      'import x from "pkg/../../cli/b.js";',
      "const c = await import(name);",
    ].join("\n");
    assert.deepEqual(lines("core/page.ts", source), []);
  });

  it("パッケージと Node の組み込みは見ない", () => {
    const source = 'import { App } from "aws-cdk-lib";\nimport { readFileSync } from "node:fs";';
    assert.deepEqual(lines("core/page.ts", source), []);
  });

  it("テストと、表にないディレクトリと、TypeScript でないファイルは見ない", () => {
    const source = 'import { x } from "../cli/lib/cli.js";';
    assert.deepEqual(lines("test/core/page.test.ts", source), []);
    assert.deepEqual(lines("samples/a.ts", source), []);
    assert.deepEqual(lines("core/notes.md", source), []);
  });
});
