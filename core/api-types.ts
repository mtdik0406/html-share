// Lambda の応答の形。Lambda と、それを呼ぶ管理画面の両方が使う。

/** ページの API が返す、ページ 1 件。 */
export interface PageEntry {
  slug: string;
  lastModified: string;
}

/** 署名の Lambda が返す、発行した URL。 */
export interface SignResult {
  url: string;
  expiresAt: string;
}
