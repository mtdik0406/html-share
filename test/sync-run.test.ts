import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import type { SyncConfig } from "../scripts/lib/config.js";
import { embedPage } from "../scripts/lib/embed.js";
import { pageKey } from "../scripts/lib/page.js";
import type { S3Sender } from "../scripts/lib/s3-sync.js";
import { runSync, type SyncDeps } from "../scripts/lib/sync-run.js";

let base: string;
let root: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "sync-run-test-"));
  root = join(base, "root");
  mkdirSync(root);
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function writePage(slug: string, body = `<p>${slug}</p>`): { slug: string; source: string } {
  const source = join(root, slug, "index.html");
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, body);
  return { slug, source };
}

const config = (...pages: { slug: string; source: string }[]): SyncConfig => ({
  roots: [root],
  pages,
});

/** S3 にある（とみなす）ページ。ETag は中身の MD5。 */
function fakeS3(remote: Record<string, string> = {}) {
  const sent: object[] = [];
  const s3: S3Sender = {
    async send(command) {
      sent.push(command);
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: Object.entries(remote).map(([Key, body]) => ({
            Key,
            ETag: `"${createHash("md5").update(body).digest("hex")}"`,
          })),
          IsTruncated: false,
        };
      }
      return {};
    },
  };
  const writes = () =>
    sent.filter((c) => c instanceof PutObjectCommand || c instanceof DeleteObjectsCommand);
  return { s3, sent, writes };
}

function deps(s3: S3Sender, overrides: Partial<SyncDeps> = {}) {
  const logs: string[] = [];
  let bucketCalls = 0;
  const d: SyncDeps = {
    s3,
    bucketName: async () => {
      bucketCalls++;
      return "bucket";
    },
    lockDir: join(base, "state", "sync.lock"),
    retiredPath: join(base, "state", "retired.json"),
    now: () => new Date("2026-11-21T00:00:00Z"),
    log: (line) => logs.push(line),
    ...overrides,
  };
  return { deps: d, logs, bucketCalls: () => bucketCalls };
}

const apply = { dryRun: false, allowMassDelete: false };
const dryRun = { dryRun: true, allowMassDelete: false };

describe("runSync", () => {
  it("--dry-run では、計画を返すだけで S3 に書かない", async () => {
    const { s3, writes } = fakeS3({ [pageKey("gone")]: "x" });
    const plan = await runSync(config(writePage("a")), dryRun, deps(s3).deps);
    assert.deepEqual(plan.add, [pageKey("a")]);
    assert.deepEqual(plan.remove, [pageKey("gone")]);
    assert.deepEqual(writes(), []);
  });

  it("消しすぎ防止に掛かったら、何も書かずに失敗する", async () => {
    const { s3, writes } = fakeS3({
      [pageKey("b")]: "x",
      [pageKey("c")]: "x",
      [pageKey("d")]: "x",
    });
    await assert.rejects(runSync(config(writePage("a")), apply, deps(s3).deps));
    assert.deepEqual(writes(), []);
  });

  it("置いて、消す", async () => {
    const { s3, writes } = fakeS3({ [pageKey("gone")]: "x" });
    await runSync(config(writePage("a")), apply, deps(s3).deps);
    assert.deepEqual(
      writes().map((c) => c.constructor),
      [PutObjectCommand, DeleteObjectsCommand],
    );
  });

  it("手元の誤り（素材の欠け）は、AWS に問い合わせる前に見つける", async () => {
    const { s3, sent } = fakeS3();
    const d = deps(s3);
    await assert.rejects(runSync(config(writePage("a", '<img src="missing.png">')), apply, d.deps));
    assert.equal(d.bucketCalls(), 0);
    assert.deepEqual(sent, []);
  });

  it("失敗してもロックを外す", async () => {
    const s3: S3Sender = {
      async send() {
        throw new Error("network");
      },
    };
    const d = deps(s3);
    await assert.rejects(runSync(config(writePage("a")), apply, d.deps));
    assert.equal(existsSync(d.deps.lockDir), false);
  });

  it("ほかの同期がロックを持っていれば、AWS に問い合わせずに失敗する", async () => {
    const { s3, sent } = fakeS3();
    const d = deps(s3);
    mkdirSync(d.deps.lockDir, { recursive: true });
    writeFileSync(join(d.deps.lockDir, "pid"), String(process.pid));
    await assert.rejects(runSync(config(writePage("a")), apply, d.deps));
    assert.equal(d.bucketCalls(), 0);
    assert.deepEqual(sent, []);
  });

  it("埋め込んだ手元のファイルを、ページごとに表示する（意図しないファイルの公開に気づけるように）", async () => {
    const page = writePage("a", '<img src="logo.png">');
    writeFileSync(join(root, "a", "logo.png"), "L");
    const { s3 } = fakeS3();
    const d = deps(s3);
    await runSync(config(page), dryRun, d.deps);
    assert.ok(d.logs.some((line) => line.includes(join("a", "logo.png"))));
  });

  it("置く中身は、手元で埋め込んだものと同じ", async () => {
    const page = writePage("a");
    const { s3, sent } = fakeS3();
    await runSync(config(page), apply, deps(s3).deps);
    const put = sent.find((c): c is PutObjectCommand => c instanceof PutObjectCommand);
    assert.deepEqual(put?.input.Body, embedPage(page.source, [root]).html);
  });
});

describe("runSync: 取り下げた slug の再利用", () => {
  it("消した slug を記録し、30 日以内に同じ slug を使おうとすると、AWS に問い合わせずに失敗する", async () => {
    const first = fakeS3({ [pageKey("old")]: "x" });
    const keep = writePage("keep");
    await runSync(config(keep), apply, deps(first.s3).deps);

    const second = fakeS3({ [pageKey("keep")]: "x" });
    const d = deps(second.s3, { now: () => new Date("2026-12-01T00:00:00Z") });
    await assert.rejects(runSync(config(keep, writePage("old")), apply, d.deps));
    assert.equal(d.bucketCalls(), 0);
  });

  it("--dry-run では記録しない", async () => {
    const { s3 } = fakeS3({ [pageKey("old")]: "x" });
    const d = deps(s3);
    await runSync(config(writePage("keep")), dryRun, d.deps);
    assert.equal(existsSync(d.deps.retiredPath), false);
  });

  it("記録した後も、消したページ以外の slug は使える", async () => {
    const { s3 } = fakeS3({ [pageKey("old")]: "x" });
    const d = deps(s3);
    await runSync(config(writePage("keep")), apply, d.deps);
    assert.ok(readFileSync(d.deps.retiredPath, "utf8").includes("old"));
    await assert.doesNotReject(
      runSync(
        config(writePage("keep"), writePage("other")),
        dryRun,
        deps(fakeS3().s3, d.deps).deps,
      ),
    );
  });
});
