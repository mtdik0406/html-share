import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_CONFIG_PATH,
  KEYS_DIR,
  LOCK_DIR,
  PUBLIC_KEY_PATH,
  REPO_ROOT,
  RETIRED_PATH,
} from "../../core/paths.js";

describe("paths", () => {
  it("REPO_ROOT は、このリポジトリのルートを指す", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    assert.equal(pkg.name, "html-share");
    assert.ok(existsSync(join(REPO_ROOT, ".gitignore")));
  });

  // 場所を固定する。.gitignore がこれらを除外していることは、ここでは確かめない。
  for (const [name, path, expected] of [
    ["KEYS_DIR", KEYS_DIR, ".keys"],
    ["PUBLIC_KEY_PATH", PUBLIC_KEY_PATH, ".keys/public.pem"],
    ["DEFAULT_CONFIG_PATH", DEFAULT_CONFIG_PATH, "html-share.config.json"],
    ["LOCK_DIR", LOCK_DIR, ".html-share/sync.lock"],
    ["RETIRED_PATH", RETIRED_PATH, ".html-share/retired.json"],
  ] as const) {
    it(`${name} は、リポジトリのルートの下の ${expected}`, () => {
      assert.equal(relative(REPO_ROOT, path).split("\\").join("/"), expected);
    });
  }
});
