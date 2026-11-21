# 運用の手順

## 配った URL を止めたい

署名付き URL は個別に取り消せない。ページを S3 から消すと、そのページの URL はすべて 403 になる（配信はキャッシュしない）。

1. `html-share.config.json` から、そのページを外す
2. `pnpm run sync --dry-run` で、`delete` にそのページだけが出ることを確かめる
3. `pnpm run sync`

同じ slug は 30 日使えない（取り下げる前に配った URL で、新しいページが見えてしまうため）。ページを配り直すときは、別の slug にして `pnpm run sign` で新しい URL を作る。

## 秘密鍵が漏れた、またはすべての URL を止めたい

鍵を作り直すと、それまでに配った URL はすべて通らなくなる（[ADR 10](adr/0010-signing-key-generations.md)）。

1. `.keys/public.pem` を、世代を名前に入れてリポジトリの外へ退避する（例：今が 1 世代目なら `mkdir ~/html-share-keys-gen1 && mv .keys/public.pem ~/html-share-keys-gen1/`）。作り直しをやめるとき、古い公開鍵で deploy し直すため。`.keys/private.pem` が残っていたら消す（古い世代の秘密鍵は SSM にある）
2. `pnpm run keygen`
3. `lib/names.ts` の `SIGNING_KEY_GENERATION` を 1 増やしてコミットする
4. `pnpm run keys:store`（新しい世代の名前に置く。古い世代の鍵には触らない）
5. `pnpm exec cdk diff` で、公開鍵が 1 つ足されて 1 つ消えることと、キーグループ・Lambda の環境変数（Key-Pair-Id とパラメータの名前）・ロールが読めるパラメータが変わることを確かめる
6. `pnpm exec cdk deploy`（終わるまでの数十秒は、`sign` が失敗することがある）
7. `pnpm run sign <slug> --minutes 5` で作った URL の `Key-Pair-Id` が、deploy の出力 `PublicKeyId`（新しい値）と同じことを確かめてから、URL を開いて表示されることを確かめる。403 なら、配信への反映を数分待ってから作り直す
8. 配り直すページの URL を `pnpm run sign` で作り直す
9. `.keys/private.pem` と、手順 1 で退避した鍵を消す
10. `pnpm run keys:delete --dry-run` で古い世代の鍵だけが出ることを確かめてから、`pnpm run keys:delete`。デプロイ済みの世代が手元の世代と違えば、何も消さずに止まる

漏れた秘密鍵は、手順 6 が終わるまで有効なまま。

手順 6 が失敗して戻ったら、スタックは古い世代のまま動き、`sign` も古い鍵で署名する。原因を直して、手順 6 からやり直す。作り直しをやめるときは、次のようにする。

1. 手順 3 のコミットを戻す
2. 新しい `.keys/` を消し、手順 1 で退避した `public.pem` を `.keys/` に戻す
3. 新しい世代の鍵は `keys:delete` が消さないので、`pnpm run keys:delete --all --dry-run` で名前を確かめ、AWS のコンソールでその 1 つだけを消す

戻す処理も失敗した（スタックが `UPDATE_ROLLBACK_FAILED` になった）ときは、CloudFormation のコンソールで原因を見てから、ロールバックを続ける。どちらの世代で署名しているかは、スタックの出力 `PublicKeyId` で分かる。

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
pnpm run keys:delete --all --dry-run   # 消す鍵の名前を確かめる
pnpm run keys:delete --all             # SSM の秘密鍵をすべての世代で消す
```

秘密鍵のパラメータは CloudFormation の外で作るので、`cdk destroy` では消えない。残したまま同じ公開鍵で deploy し直すと、その鍵がまた使われる。
