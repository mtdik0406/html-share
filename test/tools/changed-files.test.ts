import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { filesMatching } from "../../tools/changed-files.js";

// コミットのフック（pre-commit の check）から流れると、git が GIT_INDEX_FILE などを渡す。
// 残したままだと、一時のリポジトリでの git add が、作っているコミットの index に書き込まれる。
for (const name of Object.keys(process.env)) {
  if (name.startsWith("GIT_")) delete process.env[name];
}

describe("filesMatching", () => {
  const repo = mkdtempSync(join(tmpdir(), "changed-files-test-"));
  after(() => rmSync(repo, { recursive: true, force: true }));

  it("glob に当たる、git が知っているファイルと新しいファイルを、1 件ずつ返す", () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    mkdirSync(join(repo, "src"));
    for (const file of ["src/a.ts", "src/b.ts", "src/c.ts", "src/note.md", "src/new.md"]) {
      writeFileSync(join(repo, file), "");
    }
    execFileSync("git", ["add", "src/a.ts", "src/b.ts", "src/note.md"], { cwd: repo });
    assert.deepEqual(filesMatching(["src/**/*.ts"], repo).sort(), [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });
});
