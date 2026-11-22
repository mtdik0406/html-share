import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { judgeRed } from "../../../tools/lib/tdd-red.js";

describe("judgeRed", () => {
  it("アサーションで落ちたなら、期待どおりの理由で落ちている", () => {
    const output = "not ok 1 - a\n  AssertionError [ERR_ASSERTION]: Expected values to be equal";
    assert.equal(judgeRed(1, output), "red");
  });

  it("テストが通ったなら、まだ落ちていない", () => {
    assert.equal(judgeRed(0, "ok 1 - a"), "passed");
  });

  for (const [label, output] of [
    ["import の誤り", "Error [ERR_MODULE_NOT_FOUND]: Cannot find module"],
    ["書き間違い", "SyntaxError: Unexpected token"],
    ["型の合わない仮の実装", "TypeError: Cannot read properties of undefined"],
    ["名前の誤り", "ReferenceError: f is not defined"],
    ["アサーションでない失敗", "Error: 未実装"],
    [
      "アサーションと別のエラーが混ざる",
      "AssertionError [ERR_ASSERTION]: x\nTypeError: Cannot read properties of undefined",
    ],
  ] as const) {
    it(`${label}で落ちたなら、理由が違う`, () => {
      assert.equal(judgeRed(1, output), "wrong-reason");
    });
  }
});
