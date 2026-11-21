# 運用の手順

## 配った URL を止めたい

署名付き URL は個別に取り消せない。ページを S3 から消すと、そのページの URL はすべて 403 になる（配信はキャッシュしない）。

1. `html-share.config.json` から、そのページを外す
2. `pnpm run sync --dry-run` で、`delete` にそのページだけが出ることを確かめる
3. `pnpm run sync`

同じ slug は 30 日使えない（取り下げる前に配った URL で、新しいページが見えてしまうため）。ページを配り直すときは、別の slug にして `pnpm run sign` で新しい URL を作る。

## 秘密鍵が漏れた、またはすべての URL を止めたい

鍵を作り直すと、それまでに配った URL はすべて通らなくなる（[ADR 10](adr/0010-signing-key-generation.md)）。

1. `.keys/` を、リポジトリの外へ退避する（例：`mv .keys ~/html-share-keys-old`）。消さない。手順 6 が失敗したときに戻すため
2. `pnpm run keygen`
3. `lib/names.ts` の `SIGNING_KEY_GENERATION` を 1 増やしてコミットする
4. `pnpm run keys:store --overwrite`
5. `pnpm exec cdk diff` で、公開鍵が 1 つ足されて 1 つ消えることと、キーグループと Lambda の環境変数（Key-Pair-Id）が変わることを確かめる
6. `pnpm exec cdk deploy`
7. `pnpm run sign <slug> --minutes 1` で作った URL を開き、表示されることを確かめる
8. 配り直すページの URL を `pnpm run sign` で作り直す
9. `.keys/private.pem` と、手順 1 で退避した鍵を消す

漏れた秘密鍵は、手順 6 が終わるまで有効なまま。手順 4 から 6 は続けて行う。手順 4 と 6 の間に作った URL は通らないことがある。

手順 6 が失敗したら、スタックは古い公開鍵のまま戻る。SSM だけが新しい鍵になっているので、古い鍵に戻す。

1. 新しい `.keys/` を退避し、手順 1 で退避した古い `.keys/` を戻す
2. `pnpm run keys:store --overwrite`
3. `SIGNING_KEY_GENERATION` を元に戻す
4. 失敗の原因を直してから、手順 1 からやり直す

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
aws ssm delete-parameter --name /html-share/signing-private-key
```

秘密鍵のパラメータは CloudFormation の外で作るので、`cdk destroy` では消えない。残したまま同じ公開鍵で deploy し直すと、その鍵がまた使われる。
