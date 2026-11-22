import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { listRemote } from "../../core/remote-pages.js";
import { fakeSender } from "../helpers/fake-sender.js";

describe("listRemote", () => {
  it("続きのページ（ContinuationToken）をたどり、指定した接頭辞の下だけを、ETag と一緒に返す", async () => {
    const { client: s3, sent } = fakeSender((c) => {
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
    const { client: s3 } = fakeSender(() => ({
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
    const { client: s3 } = fakeSender(() => ({
      Contents: [{ Key: "pages/a/index.html", ETag: '"1"', LastModified: at }],
      IsTruncated: false,
    }));
    assert.deepEqual(await listRemote(s3, "bucket", "pages/"), [
      { key: "pages/a/index.html", etag: '"1"', lastModified: at },
    ]);
  });

  it("中身が空のバケットでは空の一覧を返す", async () => {
    const { client: s3 } = fakeSender(() => ({ IsTruncated: false }));
    assert.deepEqual(await listRemote(s3, "bucket", "pages/"), []);
  });
});
