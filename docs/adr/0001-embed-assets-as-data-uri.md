# 1. 素材を data URI でページに埋め込む

- 日付：2026-11-21
- 状態：採用

## 状況

署名付き URL は canned policy で、URL ごとに署名する。ページが相対パスで読む別ファイルには署名がなく、CloudFront が 403 を返す。

## 決定

- `sync` が、相対パスで読む素材を data URI にして、ページを 1 ファイルで置く
- JS と CSS も、`<script>`・`<style>` の中身にせず data URI で埋め込む
- CSP の `script-src`・`style-src` に `data:` を残す

## 理由

- data URI の `<script src>` なら、`defer`・`async`・`type="module"` の実行順が元のページと変わらない
- CSP は `'unsafe-inline'` を許しているので、`data:` を外しても防げるものがほとんどない

## 結果

- JS の中の `import` は解決しない。JS は 1 ファイルにまとめる
- SVG の `<use>` は data URI を描画しない（Chrome で確認）ので、エラーにする
- 素材とページの大きさに上限を設ける
