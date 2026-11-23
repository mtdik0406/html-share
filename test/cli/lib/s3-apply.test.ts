import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CopyObjectCommand, DeleteObjectsCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { applyPlan } from "../../../cli/lib/s3-apply.js";
import type { SyncPlan } from "../../../cli/lib/sync-plan.js";
import { fakeSender } from "../../helpers/fake-sender.js";

const plan = (p: Partial<SyncPlan>): SyncPlan => ({
  add: [],
  update: [],
  unchanged: [],
  remove: [],
  ...p,
});

describe("applyPlan", () => {
  it("add と update をすべて置いてから消す（途中で失敗しても、公開するはずのページを欠かさない）", async () => {
    const { client: s3, sent } = fakeSender();
    const bodies = new Map([
      ["pages/a/index.html", Buffer.from("A")],
      ["pages/b/index.html", Buffer.from("B")],
    ]);
    await applyPlan(
      s3,
      "bucket",
      plan({
        add: ["pages/a/index.html"],
        update: ["pages/b/index.html"],
        remove: ["pages/c/index.html"],
      }),
      bodies,
    );

    const kinds = sent.map((c) => c.constructor);
    assert.deepEqual(kinds, [
      PutObjectCommand,
      PutObjectCommand,
      CopyObjectCommand,
      DeleteObjectsCommand,
    ]);
    const puts = sent.filter((c): c is PutObjectCommand => c instanceof PutObjectCommand);
    assert.deepEqual(
      puts.map((c) => [c.input.Bucket, c.input.Key, String(c.input.Body)]),
      [
        ["bucket", "pages/a/index.html", "A"],
        ["bucket", "pages/b/index.html", "B"],
      ],
    );
  });

  it("HTML として表示され、文字化けしない Content-Type で置く", async () => {
    const { client: s3, sent } = fakeSender();
    await applyPlan(s3, "bucket", plan({ add: ["k"] }), new Map([["k", Buffer.from("x")]]));
    const put = sent[0] as PutObjectCommand;
    assert.match(put.input.ContentType ?? "", /^text\/html;\s*charset=utf-8$/i);
  });

  it("消すものがなければ DeleteObjects を送らない", async () => {
    const { client: s3, sent } = fakeSender();
    await applyPlan(s3, "bucket", plan({ update: ["k"] }), new Map([["k", Buffer.from("x")]]));
    assert.ok(!sent.some((c) => c instanceof DeleteObjectsCommand));
  });

  it("1 回に消すキーは 1000 件まで（1001 件なら 2 回に分ける）", async () => {
    const { client: s3, sent } = fakeSender();
    const remove = Array.from({ length: 1001 }, (_, i) => `pages/p${i}/index.html`);
    await applyPlan(s3, "bucket", plan({ remove }), new Map());
    const deletes = sent.filter(
      (c): c is DeleteObjectsCommand => c instanceof DeleteObjectsCommand,
    );
    assert.deepEqual(
      deletes.map((c) => c.input.Delete?.Objects?.length),
      [1000, 1],
    );
    assert.deepEqual(
      deletes.flatMap((c) => c.input.Delete?.Objects?.map((o) => o.Key) ?? []),
      remove,
    );
  });

  it("消せなかったキーが応答の Errors にあれば失敗する（応答自体は 200 で返る）", async () => {
    const { client: s3 } = fakeSender((c) =>
      c instanceof DeleteObjectsCommand
        ? { Errors: [{ Key: "pages/c/index.html", Code: "AccessDenied" }] }
        : {},
    );
    await assert.rejects(
      applyPlan(s3, "bucket", plan({ remove: ["pages/c/index.html"] }), new Map()),
    );
  });

  it("応答の Errors が空なら、消せたとみなす", async () => {
    const { client: s3 } = fakeSender((c) =>
      c instanceof DeleteObjectsCommand ? { Errors: [] } : {},
    );
    await applyPlan(s3, "bucket", plan({ remove: ["pages/c/index.html"] }), new Map());
  });

  it("置く中身が手元に無いキーがあれば、何も送らずに失敗する", async () => {
    const { client: s3, sent } = fakeSender();
    await assert.rejects(applyPlan(s3, "bucket", plan({ add: ["k"] }), new Map()));
    assert.equal(sent.length, 0);
  });

  it("消す前に、消すキーをすべて保管庫にコピーする（ADR 20）", async () => {
    const { client: s3, sent } = fakeSender();
    await applyPlan(
      s3,
      "bucket",
      plan({ remove: ["pages/a/index.html", "pages/b c/index.html"] }),
      new Map(),
    );
    const firstDelete = sent.findIndex((c) => c instanceof DeleteObjectsCommand);
    const copies = sent.filter((c): c is CopyObjectCommand => c instanceof CopyObjectCommand);
    assert.deepEqual(
      copies.map((c) => [c.input.Bucket, c.input.CopySource, c.input.Key]),
      [
        ["bucket", "bucket/pages/a/index.html", "archive/a/index.html"],
        ["bucket", "bucket/pages/b%20c/index.html", "archive/b c/index.html"],
      ],
    );
    assert.ok(copies.every((c) => sent.indexOf(c) < firstDelete));
  });

  it("コピーに失敗したら、何も消さない", async () => {
    const { client: s3, sent } = fakeSender((c) => {
      if (c instanceof CopyObjectCommand && c.input.Key === "archive/b/index.html") {
        throw new Error("AccessDenied");
      }
      return {};
    });
    await assert.rejects(
      applyPlan(
        s3,
        "bucket",
        plan({ remove: ["pages/a/index.html", "pages/b/index.html"] }),
        new Map(),
      ),
    );
    assert.ok(!sent.some((c) => c instanceof DeleteObjectsCommand));
  });
});
