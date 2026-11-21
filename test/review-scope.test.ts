import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { GUARDED_PATHS, guardedFiles, reviewScope } from "../tools/lib/review-scope.js";

describe("reviewScope", () => {
  it("ブランチの差分と、未コミットの変更と、新しいファイルを合わせ、重ねない", () => {
    assert.deepEqual(reviewScope(["a.ts", "b.ts"], ["b.ts"], ["c.ts"]), ["a.ts", "b.ts", "c.ts"]);
  });

  it("差分がなければ、コードの全体にする", () => {
    assert.deepEqual(reviewScope([], [], []), ["scripts/", "lib/", "bin/", "tools/", "test/"]);
  });
});

describe("guardedFiles", () => {
  for (const file of [
    "biome.json",
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

  for (const file of ["scripts/lib/embed.ts", "test/embed.test.ts", "README.md"]) {
    it(`${file} は拾わない`, () => {
      assert.deepEqual(guardedFiles([file]), []);
    });
  }
});

describe(".claude/settings.json", () => {
  it("検査・規則・設計の判断のファイルを Claude Code が編集するときは、ユーザーに確認する", () => {
    const settings = JSON.parse(readFileSync(".claude/settings.json", "utf8"));
    const ask: string[] = settings.permissions.ask;
    for (const path of GUARDED_PATHS) {
      const rule = path.endsWith("/") ? `Edit(/${path}**)` : `Edit(/${path})`;
      assert.ok(ask.includes(rule), `${rule} がない`);
    }
  });

  for (const command of [
    "git push *",
    "aws *",
    "pnpm exec cdk deploy *",
    "pnpm exec cdk destroy *",
    "pnpm run sync *",
  ]) {
    it(`${command} は、実行する前にユーザーに確認する`, () => {
      const settings = JSON.parse(readFileSync(".claude/settings.json", "utf8"));
      assert.ok(settings.permissions.ask.includes(`Bash(${command})`));
    });
  }
});
