import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  DeleteObjectsCommand,
  PutObjectCommand,
  paginateListObjectsV2,
  S3Client,
} from "@aws-sdk/client-s3";
import { runCli } from "./lib/cli.js";
import { parseConfig } from "./lib/config.js";
import { embedPage } from "./lib/embed.js";
import { acquireLock } from "./lib/lock.js";
import { PAGES_PREFIX, pageKey } from "./lib/page.js";
import { DEFAULT_CONFIG_PATH, LOCK_DIR } from "./lib/paths.js";
import { readStackOutputs } from "./lib/stack-outputs.js";
import {
  assertSafeToApply,
  type LocalObject,
  planSync,
  type RemoteObject,
} from "./lib/sync-plan.js";

/** DeleteObjects が 1 回で受け付けるキーの上限。 */
const DELETE_BATCH_SIZE = 1000;

await runCli(async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "allow-mass-delete": { type: "boolean", default: false },
    },
  });
  // 余分な引数を黙って捨てない。`--` の後ろのオプションは位置引数になり、無視されてしまうため。
  if (positionals.length !== 0) {
    throw new Error("使い方: pnpm run sync [--config <path>] [--dry-run] [--allow-mass-delete]");
  }

  const configPath = resolve(values.config ?? DEFAULT_CONFIG_PATH);
  if (!existsSync(configPath)) {
    throw new Error(
      `設定ファイルがありません: ${configPath}\nhtml-share.config.example.json を写して作ってください`,
    );
  }
  const config = parseConfig(readFileSync(configPath, "utf8"), dirname(configPath), homedir());

  // 一覧を読んでから消すまでの間に、別の同期が割り込まないようにする。
  const release = acquireLock(LOCK_DIR);
  try {
    // AWS に問い合わせる前に、手元の入力の誤りを見つける。
    const bodies = new Map<string, Buffer>();
    const local: LocalObject[] = [];
    for (const page of config.pages) {
      const { html, warnings } = embedPage(page.source, config.roots);
      for (const warning of warnings) console.warn(`warning: ${page.slug}: ${warning}`);
      const key = pageKey(page.slug);
      bodies.set(key, html);
      local.push({ key, md5: createHash("md5").update(html).digest("hex") });
    }

    const { bucketName } = await readStackOutputs();
    const s3 = new S3Client({});
    const remote = await listRemote(s3, bucketName);
    const plan = planSync(local, remote);

    for (const key of plan.put) console.log(`put       ${key}`);
    for (const key of plan.remove) console.log(`delete    ${key}`);
    console.log(`unchanged ${plan.unchanged.length} ページ`);

    assertSafeToApply(plan, remote.length, { allowMassDelete: values["allow-mass-delete"] });
    if (values["dry-run"]) {
      console.log("--dry-run なので、S3 は変えていません");
      return;
    }

    // 置いてから消す。途中で失敗しても、公開するはずのページが欠けた状態にしないため。
    for (const key of plan.put) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: bodies.get(key),
          // 付けないと application/octet-stream になり、ブラウザが表示せずにダウンロードする。
          // charset を付けないと、日本語が化けることがある。
          ContentType: "text/html; charset=utf-8",
        }),
      );
    }
    await deleteKeys(s3, bucketName, plan.remove);

    console.log(`完了: put ${plan.put.length}, delete ${plan.remove.length}`);
  } finally {
    release();
  }
});

async function listRemote(s3: S3Client, bucket: string): Promise<RemoteObject[]> {
  const objects: RemoteObject[] = [];
  for await (const page of paginateListObjectsV2(
    { client: s3 },
    { Bucket: bucket, Prefix: PAGES_PREFIX },
  )) {
    for (const o of page.Contents ?? []) {
      if (o.Key && o.ETag) objects.push({ key: o.Key, etag: o.ETag });
    }
  }
  return objects;
}

async function deleteKeys(s3: S3Client, bucket: string, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
    const res = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    // 一部のキーが消せなくても、応答は 200 で、失敗は Errors に入るだけ。
    if (res.Errors && res.Errors.length > 0) {
      const detail = res.Errors.map((e) => `${e.Key}: ${e.Code}`).join(", ");
      throw new Error(`消せなかったページがあります: ${detail}`);
    }
  }
}
