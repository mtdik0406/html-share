import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { acquireLock } from "../scripts/lib/lock.js";

let base: string;
let lockDir: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "lock-test-"));
  lockDir = join(base, "sync.lock");
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function deadPid(): number {
  // 終了済みの子プロセスの PID。すぐに再利用されることはまずない。
  const child = spawnSync(process.execPath, ["-e", ""]);
  assert.ok(child.pid);
  return child.pid;
}

describe("acquireLock", () => {
  it("取っている間は、2 つ目を拒否する", () => {
    const release = acquireLock(lockDir);
    assert.throws(() => acquireLock(lockDir));
    release();
  });

  it("親のディレクトリが無くても取れる", () => {
    const release = acquireLock(join(base, "missing", "sync.lock"));
    release();
  });

  it("解放した後は、また取れる", () => {
    acquireLock(lockDir)();
    const release = acquireLock(lockDir);
    release();
  });

  it("持ち主が終了しているロックは、取り直せる", () => {
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, "pid"), String(deadPid()));
    const release = acquireLock(lockDir);
    release();
  });

  it("取り直した後に、取り直し用のロックを残さない", () => {
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, "pid"), String(deadPid()));
    acquireLock(lockDir)();
    assert.equal(existsSync(`${lockDir}.takeover`), false);
  });

  it("シグナルを送る権限のないプロセス（ほかのユーザー）のロックは、実行中とみなして拒否する", () => {
    // PID 1 は常に存在する。root 以外からは EPERM、root からは成功になり、どちらも実行中と判定されるべき。
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, "pid"), "1");
    assert.throws(() => acquireLock(lockDir));
    assert.equal(readFileSync(join(lockDir, "pid"), "utf8"), "1");
  });

  it("ほかのプロセスが取り直しの最中なら、古いロックでも拒否する", () => {
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, "pid"), String(deadPid()));
    mkdirSync(`${lockDir}.takeover`);
    assert.throws(() => acquireLock(lockDir));
  });

  it("PID が読めないロックは、取り直さずに拒否する", () => {
    mkdirSync(lockDir);
    assert.throws(() => acquireLock(lockDir));
  });
});
