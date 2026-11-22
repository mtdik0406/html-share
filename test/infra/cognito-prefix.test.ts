// prefix はパスキーの RP ID になる。決め方が変わると登録済みのパスキーが使えなくなるので、値を固定する。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cognitoDomainPrefix } from "../../infra/cognito-prefix.js";

describe("cognitoDomainPrefix", () => {
  it("同じアカウントには、いつも同じ値を返す", () => {
    assert.equal(cognitoDomainPrefix("111111111111"), "html-share-a18ac4e6fbd3");
  });

  it("アカウントが違えば、違う値を返す", () => {
    assert.notEqual(cognitoDomainPrefix("111111111111"), cognitoDomainPrefix("222222222222"));
  });

  it("Cognito の prefix の規則（英小文字・数字・ハイフン、63 文字以内）に合う", () => {
    assert.match(cognitoDomainPrefix("123456789012"), /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
  });
});
