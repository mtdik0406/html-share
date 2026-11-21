import {
  DeleteObjectsCommand,
  type DeleteObjectsCommandOutput,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { RemoteObject, SyncPlan } from "./sync-plan.js";

/** S3Client の send だけを使う。テストで偽物に差し替えるため。 */
export interface S3Sender {
  send(command: object): Promise<unknown>;
}

/** DeleteObjects が 1 回で受け付けるキーの上限。 */
const DELETE_BATCH_SIZE = 1000;

export async function listRemote(
  s3: S3Sender,
  bucket: string,
  prefix: string,
): Promise<RemoteObject[]> {
  const objects: RemoteObject[] = [];
  let token: string | undefined;
  do {
    const res = (await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    )) as ListObjectsV2CommandOutput;
    for (const o of res.Contents ?? []) {
      if (o.Key && o.ETag) objects.push({ key: o.Key, etag: o.ETag });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token !== undefined);
  return objects;
}

export async function applyPlan(
  s3: S3Sender,
  bucket: string,
  plan: SyncPlan,
  bodies: ReadonlyMap<string, Buffer>,
): Promise<void> {
  const puts = [...plan.add, ...plan.update].map((key) => {
    const body = bodies.get(key);
    if (body === undefined) throw new Error(`置く中身がありません: ${key}`);
    return { key, body };
  });

  // 置いてから消す。途中で失敗しても、公開するはずのページが欠けた状態にしないため。
  for (const { key, body } of puts) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        // 付けないと application/octet-stream になり、ブラウザが表示せずにダウンロードする。
        // charset を付けないと、日本語が化けることがある。
        ContentType: "text/html; charset=utf-8",
      }),
    );
  }

  for (let i = 0; i < plan.remove.length; i += DELETE_BATCH_SIZE) {
    const batch = plan.remove.slice(i, i + DELETE_BATCH_SIZE);
    const res = (await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    )) as DeleteObjectsCommandOutput;
    // 一部のキーが消せなくても、応答は 200 で、失敗は Errors に入るだけ。
    if (res.Errors && res.Errors.length > 0) {
      const detail = res.Errors.map((e) => `${e.Key}: ${e.Code}`).join(", ");
      throw new Error(`消せなかったページがあります: ${detail}`);
    }
  }
}
