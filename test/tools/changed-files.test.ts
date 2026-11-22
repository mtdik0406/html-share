import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { filesMatching } from "../../tools/changed-files.js";

describe("filesMatching", () => {
  const repo = mkdtempSync(join(tmpdir(), "changed-files-test-"));
  after(() => rmSync(repo, { recursive: true, force: true }));

  it("glob に当たる、git が知っているファイルと新しいファイルを、1 件ずつ返す", () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    mkdirSync(join(repo, "src"));
    for (const file of ["src/a.ts", "src/b.ts", "src/c.ts", "src/note.md"]) {
      writeFileSync(join(repo, file), "");
    }
    execFileSync("git", ["add", "src/a.ts", "src/b.ts"], { cwd: repo });
    assert.deepEqual(filesMatching(["src/**/*.ts"], repo).sort(), [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });
});
