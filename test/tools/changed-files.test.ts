import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { filesMatching, trackedFiles } from "../../tools/changed-files.js";

// コミットのフック（pre-commit の check）から流れると、git が GIT_INDEX_FILE などを渡す。
// 残したままだと、一時のリポジトリでの git add が、作っているコミットの index に書き込まれる。
for (const name of Object.keys(process.env)) {
  if (name.startsWith("GIT_")) delete process.env[name];
}

describe("git のファイルの一覧", () => {
  const repo = mkdtempSync(join(tmpdir(), "changed-files-test-"));
  before(() => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    mkdirSync(join(repo, "src"));
    mkdirSync(join(repo, "共有"));
    const files = ["src/a.ts", "src/b.ts", "src/c.ts", "src/note.md", "src/new.md", "共有/メモ.ts"];
    for (const file of files) writeFileSync(join(repo, file), "");
    execFileSync("git", ["add", "src/a.ts", "src/b.ts", "src/note.md", "共有/メモ.ts"], {
      cwd: repo,
    });
  });
  after(() => rmSync(repo, { recursive: true, force: true }));

  it("filesMatching は、glob に当たる、git が知っているファイルと新しいファイルを、1 件ずつ返す", () => {
    assert.deepEqual(filesMatching(["src/**/*.ts"], repo).sort(), [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });

  it("trackedFiles は、追跡しているファイルだけを、日本語の名前も引用符なしで返す", () => {
    assert.deepEqual(trackedFiles(repo).sort(), [
      "src/a.ts",
      "src/b.ts",
      "src/note.md",
      "共有/メモ.ts",
    ]);
  });

  it("filesMatching も、日本語の名前を引用符なしで返す", () => {
    assert.deepEqual(filesMatching(["共有/**"], repo), ["共有/メモ.ts"]);
  });
});
