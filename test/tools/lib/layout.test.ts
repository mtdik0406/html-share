import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CODE_DIRS, findUnlistedDirs } from "../../../tools/lib/layout.js";

describe("CODE_DIRS", () => {
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
});

describe("findUnlistedDirs", () => {
  it("表にあるディレクトリと test の .ts だけなら、何も見つけない", () => {
    assert.deepEqual(
      findUnlistedDirs(["core/page.ts", "test/core/page.test.ts", "bin/app.ts"]),
      [],
    );
  });

  it(".ts があるのに表にない直下のディレクトリを、1 回ずつ見つける", () => {
    assert.deepEqual(
      findUnlistedDirs(["shared/a.ts", "shared/b/c.ts", "core/page.ts", "extra/d.ts"]),
      ["shared", "extra"],
    );
  });

  it(".ts でないファイルと、直下の .ts は数えない", () => {
    assert.deepEqual(
      findUnlistedDirs(["docs/adr/0001.md", "scratch/a.json", "eslint.config.ts"]),
      [],
    );
  });

  it("名前の先頭だけが表と同じディレクトリは、表にあるとみなさない", () => {
    assert.deepEqual(findUnlistedDirs(["core2/a.ts", "clix/b.ts"]), ["core2", "clix"]);
  });
});
