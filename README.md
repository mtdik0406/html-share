# html-share

AI が作った HTML を自分の AWS に置き、期限付きの署名付き URL を持つ人にだけ見せるツール。

```
閲覧者 ──(署名付き URL)──▶ CloudFront ──(OAC)──▶ S3（非公開）
                           └ 公開鍵で署名を検証
```

## 必要なもの

- Node.js 22 以降
- AWS CLI と、デプロイ先のアカウントにログインできるプロファイル
- CloudFront の既定のドメイン（`xxxx.cloudfront.net`）で動く。独自ドメインと ACM 証明書は使わない

## セットアップ

```sh
npm ci
npm run keygen                      # .keys/ に RSA 2048 の鍵ペアを作る（既存の鍵は上書きしない）
export AWS_PROFILE=<プロファイル名>
npx cdk bootstrap                   # アカウントとリージョンごとに 1 回だけ
npx cdk deploy
```

`.keys/private.pem` は秘密鍵で、git の対象外。AWS にも送らない。
deploy した後に鍵を作り直すと、登録済みの公開鍵と合わなくなり、すべての URL が通らなくなる。

## 使い方

```sh
npm run upload -- samples/hello.html page-a              # S3 の pages/page-a/index.html に置く
npm run upload -- samples/hello.html page-a --overwrite  # 既存のページを上書きする
npm run sign -- page-a                                   # 7 日間有効な URL（既定）
npm run sign -- page-a --days 3
npm run sign -- page-a --minutes 1                       # 期限は 1 分以上、30 日以内
```

## 制約

- **ページは 1 ファイルで完結させる。** 署名は URL ごと（canned policy）なので、ページが相対パスで読む CSS・画像・JS には署名がなく、403 になる。CSS と JS はインラインに書き、画像は data URI にする。
- 期限内の署名付き URL を持つ人は誰でも見られる。渡す相手と期限で管理する。

## 開発

```sh
npm run check    # 型チェック・lint・テストをまとめて実行する
npm run format   # 書式を直す
npx cdk synth    # テンプレートを cdk.out/ に出す（AWS には何も作らない）
npx cdk diff     # AWS 上の今の状態との差分を見る
```

| ディレクトリ   | 中身                                                               |
| -------------- | ------------------------------------------------------------------ |
| `bin/`         | CDK アプリの入口。どのスタックを、どの設定で作るか                 |
| `lib/`         | スタックの定義（S3・CloudFront・公開鍵）                           |
| `scripts/`     | CLI（keygen・upload・sign）                                        |
| `scripts/lib/` | CLI が使う部品。AWS を呼ばない純粋な関数は、ここに分けてテストする |
| `test/`        | スタックの安全性の不変条件と、純粋な関数の境界値のテスト           |
| `samples/`     | 動作確認用の HTML                                                  |

## 片付け

```sh
npx cdk destroy   # バケットの中身ごと消える
```

## 謝辞

構成は [minorun365/html-share](https://github.com/minorun365/html-share)（Apache-2.0）を参考にした。コードは独自に書いている。
