// Lambda の要求と応答の形。Lambda と、それを呼ぶ CLI・管理画面が同じ型を使い、片側だけが変わらないようにする（ADR 15）。

/** ページの API が返す、ページ 1 件。 */
export interface PageEntry {
  slug: string;
  lastModified: string;
}

/** 署名の Lambda に渡す要求。 */
export interface SignRequest {
  slug: string;
  lifetimeMs: number;
}

/** 署名の Lambda が返す、発行した URL。 */
export interface SignResult {
  url: string;
  expiresAt: string;
}
