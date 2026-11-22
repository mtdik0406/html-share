// 管理画面の Lambda が SSM から読む設定。スタックが書く値なので、欠けていたら動かさずに止める。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAdminConfig } from "../core/admin-config.js";

const VALID = {
  userPoolId: "ap-northeast-1_TEST",
  clientId: "client123",
  cognitoDomain: "hs-test.auth.ap-northeast-1.amazoncognito.com",
  adminDomain: "dadmin.cloudfront.net",
};

describe("parseAdminConfig", () => {
  it("4 つの値を読む", () => {
    assert.deepEqual(parseAdminConfig(JSON.stringify(VALID)), VALID);
  });

  it("余分な値は持ち込まない", () => {
    assert.deepEqual(parseAdminConfig(JSON.stringify({ ...VALID, extra: "x" })), VALID);
  });

  it("値が欠けている・空・文字列でない・JSON でないときは失敗する", () => {
    for (const key of Object.keys(VALID)) {
      for (const value of [undefined, "", 1]) {
        assert.throws(() => parseAdminConfig(JSON.stringify({ ...VALID, [key]: value })), key);
      }
    }
    assert.throws(() => parseAdminConfig("not json"));
    assert.throws(() => parseAdminConfig("null"));
  });
});
