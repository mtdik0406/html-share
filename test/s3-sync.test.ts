import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { applyPlan, listRemote, type S3Sender } from "../core/s3-sync.js";
import type { SyncPlan } from "../core/sync-plan.js";

function fakeS3(respond: (command: object) => unknown = () => ({})) {
  const sent: object[] = [];
  const s3: S3Sender = {
    async send(command) {
      sent.push(command);
      return respond(command);
    },
  };
  return { s3, sent };
}

const plan = (p: Partial<SyncPlan>): SyncPlan => ({
  add: [],
  update: [],
  unchanged: [],
  remove: [],
  ...p,
});

describe("applyPlan", () => {
  it("add と update をすべて置いてから消す（途中で失敗しても、公開するはずのページを欠かさない）", async () => {
    const { s3, sent } = fakeS3();
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
    assert.deepEqual(kinds, [PutObjectCommand, PutObjectCommand, DeleteObjectsCommand]);
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
    const { s3, sent } = fakeS3();
    await applyPlan(s3, "bucket", plan({ add: ["k"] }), new Map([["k", Buffer.from("x")]]));
    const put = sent[0] as PutObjectCommand;
    assert.match(put.input.ContentType ?? "", /^text\/html;\s*charset=utf-8$/i);
  });

  it("消すものがなければ DeleteObjects を送らない", async () => {
    const { s3, sent } = fakeS3();
    await applyPlan(s3, "bucket", plan({ update: ["k"] }), new Map([["k", Buffer.from("x")]]));
    assert.ok(!sent.some((c) => c instanceof DeleteObjectsCommand));
  });

  it("1 回に消すキーは 1000 件まで（1001 件なら 2 回に分ける）", async () => {
    const { s3, sent } = fakeS3();
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
    const { s3 } = fakeS3((c) =>
      c instanceof DeleteObjectsCommand
        ? { Errors: [{ Key: "pages/c/index.html", Code: "AccessDenied" }] }
        : {},
    );
    await assert.rejects(
      applyPlan(s3, "bucket", plan({ remove: ["pages/c/index.html"] }), new Map()),
    );
  });

  it("置く中身が手元に無いキーがあれば、何も送らずに失敗する", async () => {
    const { s3, sent } = fakeS3();
    await assert.rejects(applyPlan(s3, "bucket", plan({ add: ["k"] }), new Map()));
    assert.equal(sent.length, 0);
  });
});

describe("listRemote", () => {
  it("続きのページ（ContinuationToken）をたどり、指定した接頭辞の下だけを、ETag と一緒に返す", async () => {
    const { s3, sent } = fakeS3((c) => {
      const token = (c as ListObjectsV2Command).input.ContinuationToken;
      return token === undefined
        ? {
            Contents: [{ Key: "pages/a/index.html", ETag: '"1"' }],
            IsTruncated: true,
            NextContinuationToken: "t2",
          }
        : { Contents: [{ Key: "pages/b/index.html", ETag: '"2"' }], IsTruncated: false };
    });
    const remote = await listRemote(s3, "bucket", "pages/");
    assert.deepEqual(remote, [
      { key: "pages/a/index.html", etag: '"1"' },
      { key: "pages/b/index.html", etag: '"2"' },
    ]);
    assert.ok(sent.every((c) => c instanceof ListObjectsV2Command));
    assert.ok(sent.every((c) => (c as ListObjectsV2Command).input.Prefix === "pages/"));
    assert.equal(sent.length, 2);
  });

  it("キーか ETag のないオブジェクトは返さない", async () => {
    const { s3 } = fakeS3(() => ({
      Contents: [
        { Key: "pages/a/index.html" },
        { ETag: '"2"' },
        { Key: "pages/c/index.html", ETag: '"3"' },
      ],
      IsTruncated: false,
    }));
    assert.deepEqual(await listRemote(s3, "bucket", "pages/"), [
      { key: "pages/c/index.html", etag: '"3"' },
    ]);
  });

  it("更新時刻があれば、一緒に返す", async () => {
    const at = new Date("2030-01-02T03:04:05Z");
    const { s3 } = fakeS3(() => ({
      Contents: [{ Key: "pages/a/index.html", ETag: '"1"', LastModified: at }],
      IsTruncated: false,
    }));
    assert.deepEqual(await listRemote(s3, "bucket", "pages/"), [
      { key: "pages/a/index.html", etag: '"1"', lastModified: at },
    ]);
  });

  it("中身が空のバケットでは空の一覧を返す", async () => {
    const { s3 } = fakeS3(() => ({ IsTruncated: false }));
    assert.deepEqual(await listRemote(s3, "bucket", "pages/"), []);
  });
});
