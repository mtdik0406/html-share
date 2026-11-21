# 運用の手順

## 配った URL を止めたい

署名付き URL は個別に取り消せない。ページを S3 から消すと、そのページの URL はすべて 403 になる（配信はキャッシュしない）。

1. `html-share.config.json` から、そのページを外す
2. `pnpm run sync --dry-run` で、`delete` にそのページだけが出ることを確かめる
3. `pnpm run sync`

同じ slug は 30 日使えない（取り下げる前に配った URL で、新しいページが見えてしまうため）。ページを配り直すときは、別の slug にして `pnpm run sign` で新しい URL を作る。

## 秘密鍵が漏れた、またはすべての URL を止めたい

鍵を作り直すと、それまでに配った URL はすべて通らなくなる。

1. `.keys/` の鍵を、リポジトリの外へ移すか消す（`keygen` は既存の鍵を上書きしない）
2. `pnpm run keygen`
3. `pnpm exec cdk diff` で、変わるのが公開鍵とキーグループ（と、それを参照する Lambda の環境変数）だけであることを確かめる
4. `pnpm exec cdk deploy`
5. `pnpm run keys:store --overwrite`
6. 配り直すページの URL を `pnpm run sign` で作り直す
7. `.keys/private.pem` を消す

漏れた秘密鍵は、手順 4 が終わるまで有効なまま。先に手順 4 まで済ませる。手順 4 と 5 の間は、`sign` が古い鍵で署名するので、作った URL は通らない。

## AWS の認証情報が漏れた

このリポジトリの手順では止められない。AWS のコンソールで、そのアクセスキーを無効にする。

## 依存の脆弱性を、14 日待たずに直したい

公開から 14 日たっていない版は入らない（[ADR 5](adr/0005-minimum-release-age.md)）。修正版を待てないときだけ、その版を例外にする。

1. `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` に、パッケージ名と版を書く（例：`"@aws-sdk/client-s3@3.2000.1"`）。名前だけで書くと、以後のすべての版が下限なしで入る
2. `pnpm install` が、修正版の依存（間接の依存）の若い版で止まったら、その版も同じように足す
3. 14 日たったら、足した行を消す

脆弱性は、GitHub の Dependabot のアラートで知らせる。

## すべて片付けたい

```sh
pnpm exec cdk destroy   # バケットの中身ごと消える。配った URL はすべて通らなくなる
```
