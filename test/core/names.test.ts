import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_PATHS,
  generationOfParameterName,
  signingKeyParameterName,
} from "../../core/names.js";

describe("signingKeyParameterName", () => {
  it("1 世代目は、世代を分ける前と同じ名前", () => {
    assert.equal(signingKeyParameterName(1), "/html-share/signing-private-key");
  });

  it("2 世代目からは、世代ごとに別の名前", () => {
    assert.equal(signingKeyParameterName(2), "/html-share/signing-private-key-gen2");
    assert.equal(signingKeyParameterName(10), "/html-share/signing-private-key-gen10");
  });

  it("世代が 1 以上の整数でなければ失敗する", () => {
    for (const generation of [0, -1, 1.5, Number.NaN]) {
      assert.throws(() => signingKeyParameterName(generation));
    }
  });
});

describe("generationOfParameterName", () => {
  it("名前から世代を読む", () => {
    for (const generation of [1, 2, 10]) {
      assert.equal(generationOfParameterName(signingKeyParameterName(generation)), generation);
    }
  });

  it("署名の鍵の名前でなければ undefined", () => {
    for (const name of [
      "/html-share/other",
      "/html-share/signing-private-key-gen",
      "/html-share/signing-private-key-gen1",
      "/html-share/signing-private-key-gen0",
      "/html-share/signing-private-key-gen02",
      "/html-share/signing-private-key-genx",
      "/html-share/signing-private-key/gen2",
      "/html-share/signing-private-key-old-gen2",
      "/html-share/signing-private-key-gen2x",
      "x/html-share/signing-private-key",
    ]) {
      assert.equal(generationOfParameterName(name), undefined, name);
    }
  });
});

describe("ADMIN_PATHS", () => {
  // パスがビヘイビアのパターンの外にあると、別のビヘイビア（署名を求める既定）に落ち、サインインできなくなる。
  const under = (pattern: string, path: string) =>
    pattern.endsWith("*") && path.startsWith(pattern.slice(0, -1));

  it("サインインのパスは、どれも署名を求めないビヘイビアの下にある", () => {
    for (const path of [
      ADMIN_PATHS.login,
      ADMIN_PATHS.callback,
      ADMIN_PATHS.logout,
      ADMIN_PATHS.signedOut,
    ]) {
      assert.ok(under(ADMIN_PATHS.authPattern, path), path);
    }
  });

  it("ページの API のパスは、API のビヘイビアの下にある", () => {
    assert.ok(under(ADMIN_PATHS.pagesApiPattern, ADMIN_PATHS.pagesApi));
  });
});
