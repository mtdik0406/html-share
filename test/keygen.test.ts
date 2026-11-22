// 一時ディレクトリだけを使う。本物の .keys/ には触れない。
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { writeKeyPair } from "../cli/lib/keygen.js";
import { PRIVATE_KEY_FILE, PUBLIC_KEY_FILE } from "../core/paths.js";

describe("writeKeyPair", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), "html-share-keygen-")), "keys");
  });
  afterEach(() => {
    rmSync(join(dir, ".."), { recursive: true, force: true });
  });

  it("対になる RSA 2048 の鍵ペアを作る（秘密鍵の署名を公開鍵で検証できる）", () => {
    const { privateKeyPath, publicKeyPath } = writeKeyPair(dir);
    const privateKey = createPrivateKey(readFileSync(privateKeyPath));
    const publicKey = createPublicKey(readFileSync(publicKeyPath));

    assert.equal(privateKey.asymmetricKeyType, "rsa");
    assert.equal(privateKey.asymmetricKeyDetails?.modulusLength, 2048);
    const data = Buffer.from("html-share");
    assert.ok(verify("sha256", data, publicKey, sign("sha256", data, privateKey)));
  });

  it("公開鍵は CloudFront が受け付ける PEM（BEGIN PUBLIC KEY）で書く", () => {
    const { publicKeyPath } = writeKeyPair(dir);
    assert.match(readFileSync(publicKeyPath, "utf8"), /^-----BEGIN PUBLIC KEY-----/);
  });

  it("秘密鍵と鍵のディレクトリは自分だけが読める", () => {
    const { privateKeyPath } = writeKeyPair(dir);
    assert.equal(statSync(privateKeyPath).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  });

  it("2 回目は失敗し、既存の鍵を変えない", () => {
    const { privateKeyPath } = writeKeyPair(dir);
    const before = readFileSync(privateKeyPath);

    assert.throws(() => writeKeyPair(dir));
    assert.deepEqual(readFileSync(privateKeyPath), before);
  });

  for (const leftover of [PRIVATE_KEY_FILE, PUBLIC_KEY_FILE]) {
    it(`${leftover} だけが残っていても、何も書かずに失敗する`, () => {
      writeKeyPair(dir);
      const other = leftover === PRIVATE_KEY_FILE ? PUBLIC_KEY_FILE : PRIVATE_KEY_FILE;
      rmSync(join(dir, other));
      writeFileSync(join(dir, leftover), "placeholder");

      assert.throws(() => writeKeyPair(dir));
      assert.equal(readFileSync(join(dir, leftover), "utf8"), "placeholder");
      assert.throws(() => statSync(join(dir, other)), { code: "ENOENT" });
    });
  }
});
