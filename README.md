# html-share

AI が作った HTML を自分の AWS に置き、期限付きの署名付き URL を持つ人にだけ見せるツール。

```
閲覧者 ──(署名付き URL)──▶ CloudFront ──(OAC)──▶ S3（非公開）
                           └ 公開鍵で署名を検証
```

## 必要なもの

- Node.js 22 以降と pnpm（バージョンは `package.json` の `packageManager`）
- AWS CLI と、デプロイ先のアカウントにログインできるプロファイル
- CloudFront の既定のドメイン（`xxxx.cloudfront.net`）で動く。独自ドメインと ACM 証明書は使わない

## セットアップ

```sh
pnpm install --frozen-lockfile
pnpm run keygen                     # .keys/ に RSA 2048 の鍵ペアを作る（既存の鍵は上書きしない）
export AWS_PROFILE=<プロファイル名>
pnpm exec cdk bootstrap             # アカウントとリージョンごとに 1 回だけ
pnpm exec cdk deploy
```

`.keys/private.pem` は秘密鍵で、git の対象外。AWS にも送らない。
deploy した後に鍵を作り直すと、登録済みの公開鍵と合わなくなり、すべての URL が通らなくなる。

## 使い方

```sh
pnpm run upload samples/hello.html page-a              # S3 の pages/page-a/index.html に置く
pnpm run upload samples/hello.html page-a --overwrite  # 既存のページを上書きする
pnpm run sign page-a                                   # 7 日間有効な URL（既定）
pnpm run sign page-a --days 3
pnpm run sign page-a --minutes 1                       # 期限は 1 分以上、30 日以内
```

引数の前に `--` を付けない。pnpm は `--` もそのままスクリプトに渡すので、余分な引数としてエラーになる。

## 制約

- **ページは 1 ファイルで完結させる。** CSS と JS はインラインに書き、画像・フォント・音声・動画は data URI にする。
  - 相対パスで読む素材には署名がないので 403 になる（署名は URL ごとの canned policy）
  - 外部の URL（CDN のライブラリ、Google Fonts、外部の画像など）は CSP で読み込めない
- **ページは sandbox の中で動き、許されるのはインラインの JS の実行だけ。** 設定は `lib/html-share-stack.ts` の Content-Security-Policy。
  - `fetch`・XHR・WebSocket は通らない。外部の API を呼ぶページは動かない
  - Cookie・`localStorage`・`sessionStorage` は使えない（触ると例外になる）
  - `target="_blank"` のリンクは開かない（何も起きない）
  - フォームの送信、`alert`・`confirm`・`print`、ダウンロードはできない
  - `eval` と `new Function` は使えない
- **外への持ち出しは減らしているが、ゼロではない。** 信用できない JS を含むページは公開しない。
  - ページの JS が自分自身を外部の URL へ移動させると、そのページの署名付き URL や閲覧者の情報を渡せる。ヘッダーでは止められない
  - WebRTC など、CSP で止めきれない通信の経路がある（ブラウザによって異なる）
- 応答には `Cache-Control: no-store`・`X-Robots-Tag: noindex`・`Referrer-Policy: no-referrer` も付く。期限切れの URL をブラウザのキャッシュで見せず、署名付き URL を Referer で外部に渡さないため。
- 期限内の署名付き URL を持つ人は誰でも見られる。渡す相手と期限で管理する。

## 開発

```sh
pnpm run check        # 型チェック・lint・テストをまとめて実行する
pnpm run format       # 書式を直す
pnpm exec cdk synth   # テンプレートを cdk.out/ に出す（AWS には何も作らない）
pnpm exec cdk diff    # AWS 上の今の状態との差分を見る
```

| ディレクトリ   | 中身                                                               |
| -------------- | ------------------------------------------------------------------ |
| `bin/`         | CDK アプリの入口。どのスタックを、どの設定で作るか                 |
| `lib/`         | スタックの定義（S3・CloudFront・公開鍵・応答ヘッダー）             |
| `scripts/`     | CLI（keygen・upload・sign）                                        |
| `scripts/lib/` | CLI が使う部品。AWS を呼ばない純粋な関数は、ここに分けてテストする |
| `test/`        | スタックの安全性の不変条件と、純粋な関数の境界値のテスト           |
| `samples/`     | 動作確認用の HTML                                                  |

## 片付け

```sh
pnpm exec cdk destroy   # バケットの中身ごと消える
```

## 謝辞

構成は [minorun365/html-share](https://github.com/minorun365/html-share)（Apache-2.0）を参考にした。コードは独自に書いている。

## ライセンス

[MIT](LICENSE)
