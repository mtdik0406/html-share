import { ListObjectsV2Command, type ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";

/** S3 に置いたページ 1 つ。 */
export interface RemoteObject {
  key: string;
  etag: string;
  /** 管理画面の一覧に出す。同期の計画には使わない。 */
  lastModified?: Date;
}

/** S3Client の send だけを使う。テストで偽物に差し替えるため。 */
export interface S3Sender {
  send(command: object): Promise<unknown>;
}

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
    // Stryker disable next-line ArrayDeclaration: Key と ETag のない要素は飛ばすので、既定の配列に何が入っても同じ
    for (const o of res.Contents ?? []) {
      if (o.Key && o.ETag) {
        objects.push({
          key: o.Key,
          etag: o.ETag,
          ...(o.LastModified ? { lastModified: o.LastModified } : {}),
        });
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token !== undefined);
  return objects;
}
