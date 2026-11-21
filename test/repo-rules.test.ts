import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adrChangedOutsideStatus,
  findForbiddenText,
  findMessageAssertions,
} from "../tools/lib/repo-rules.js";

describe("findForbiddenText", () => {
  const home = ["", "Users", "someone", "work"].join("/");
  for (const [label, text] of [
    ["macOS のホームの絶対パス", `see ${home}/a.ts`],
    ["Linux のホームの絶対パス", "see /home/someone/a.ts"],
    ["作った経緯の言葉", "学習用のツール"],
    ["段階の番号", "段階 4 で足す"],
  ] as const) {
    it(`${label} を見つける`, () => {
      assert.equal(findForbiddenText(text).length, 1);
    });
  }

  for (const [label, text] of [
    ["リポジトリの中の相対パス", "scripts/lib/embed.ts"],
    ["~ で始まるパス", "~/work/pages"],
    ["番号の付かない「段階」", "段階的に移す"],
  ] as const) {
    it(`${label} は通す`, () => {
      assert.deepEqual(findForbiddenText(text), []);
    });
  }

  it("見つけた行の番号を返す", () => {
    assert.deepEqual(
      findForbiddenText("a\nb\n学習用").map((f) => f.line),
      [3],
    );
  });
});

describe("findMessageAssertions", () => {
  for (const [label, source] of [
    ["正規表現", "assert.throws(() => f(), /bad/);"],
    ["文字列", 'await assert.rejects(p, "bad");'],
    ["message を持つオブジェクト", "assert.throws(() => f(), { message: 'bad' });"],
    ["message を読む関数", "assert.throws(() => f(), (e) => e.message === 'bad');"],
  ] as const) {
    it(`${label}でエラーの文言を見ていれば見つける`, () => {
      assert.equal(findMessageAssertions(source).length, 1);
    });
  }

  for (const [label, source] of [
    ["失敗することだけ", "assert.throws(() => f());"],
    ["エラーの種類", "assert.throws(() => f(), TypeError);"],
    ["文言以外を見る関数", "assert.throws(() => f(), (e) => e.cause instanceof RangeError);"],
    ["失敗しないこと", "assert.doesNotThrow(() => f(), /x/);"],
  ] as const) {
    it(`${label}は通す`, () => {
      assert.deepEqual(findMessageAssertions(source), []);
    });
  }
});

describe("adrChangedOutsideStatus", () => {
  const adr = (status: string, body = "## 決定\n\n- A\n") =>
    `# 1. 題\n\n- 日付：2026-11-21\n- 状態：${status}\n\n${body}`;

  it("状態の行だけを変えたなら通す（置き換えた ADR を書くとき）", () => {
    assert.equal(adrChangedOutsideStatus(adr("採用"), adr("0006 で置き換え")), false);
  });

  it("変えていなければ通す", () => {
    assert.equal(adrChangedOutsideStatus(adr("採用"), adr("採用")), false);
  });

  it("状態の行の外を変えたら見つける", () => {
    assert.equal(adrChangedOutsideStatus(adr("採用"), adr("採用", "## 決定\n\n- B\n")), true);
  });
});
