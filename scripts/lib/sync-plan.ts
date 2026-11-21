export interface LocalObject {
  key: string;
  md5: string;
}

export interface RemoteObject {
  key: string;
  etag: string;
}

export interface SyncPlan {
  add: string[];
  /** 配布済みの URL で見える中身が変わるページ。 */
  update: string[];
  unchanged: string[];
  remove: string[];
}

/** S3 のページのうち、この割合以上を一度に消す同期は、明示しない限り実行しない。 */
const MASS_DELETE_RATIO = 0.2;

/**
 * 手元を正として、S3 を手元と同じにするための操作を決める。
 * ETag と MD5 の比較は、SSE-S3 で単一の PUT で置いたオブジェクトでだけ成り立つ。
 * 成り立たないオブジェクト（マルチパートなど）は毎回置き直すことになるが、中身は正しく保たれる。
 */
export function planSync(local: readonly LocalObject[], remote: readonly RemoteObject[]): SyncPlan {
  const remoteEtags = new Map(remote.map((o) => [o.key, normalizeEtag(o.etag)]));
  const localKeys = new Set(local.map((o) => o.key));

  const plan: SyncPlan = { add: [], update: [], unchanged: [], remove: [] };
  for (const { key, md5 } of local) {
    const etag = remoteEtags.get(key);
    if (etag === undefined) plan.add.push(key);
    else if (etag === md5.toLowerCase()) plan.unchanged.push(key);
    else plan.update.push(key);
  }
  plan.remove = remote.map((o) => o.key).filter((key) => !localKeys.has(key));
  return plan;
}

/**
 * 設定の読み違いや書きかけの状態で、公開中のページをまとめて消さないための歯止め。
 * 手元が空の同期は、フラグがあっても止める。全部を消すのが目的なら cdk destroy のほうが確実なため。
 */
export function assertSafeToApply(
  plan: SyncPlan,
  remoteCount: number,
  { allowMassDelete }: { allowMassDelete: boolean },
): void {
  if (plan.add.length + plan.update.length + plan.unchanged.length === 0) {
    throw new Error("公開するページが 1 つもありません。設定ファイルを確かめてください");
  }
  if (
    plan.remove.length > 0 &&
    plan.remove.length >= remoteCount * MASS_DELETE_RATIO &&
    !allowMassDelete
  ) {
    throw new Error(
      `公開中の ${remoteCount} ページのうち ${plan.remove.length} ページを消します。` +
        "意図どおりなら --allow-mass-delete を付けてください",
    );
  }
}

function normalizeEtag(etag: string): string {
  return etag.replaceAll('"', "").toLowerCase();
}
