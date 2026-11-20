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

公開するページは設定ファイル `html-share.config.json` に並べる。手元のパスを含むので git の対象外にしている。書き方は `html-share.config.example.json` を写して使う。

```json
{
  "roots": ["~/work/pages"],
  "pages": [{ "slug": "report", "source": "~/work/pages/report/index.html" }]
}
```

- `roots`：ページと素材を置いてよいディレクトリ。この外のファイルは、シンボリックリンクで指していても使わない
- `pages`：`slug` は URL のパスになる（英小文字・数字・ハイフン、64 文字以内）。`source` は元の HTML
- 相対パスは設定ファイルのあるディレクトリから、`~/` はホームから解決する

```sh
pnpm run sync --dry-run                 # S3 をどう変えるかだけを表示する
pnpm run sync                           # S3 の pages/ を設定と同じにする
pnpm run sync --config path/to/config.json
pnpm run sign report                    # 7 日間有効な URL（既定）
pnpm run sign report --days 3
pnpm run sign report --minutes 1        # 期限は 1 分以上、30 日以内
```

`sync` は、設定を正として S3 の `pages/` の下を同じにする。

- 設定にあり、S3 に無いか中身が違うページを置く。中身が同じページは送らない
- **設定に無いページは S3 から消す。** 配布済みの URL を止める手段はこれしかない（署名付き URL は個別に取り消せない）
- 公開中のページの 2 割以上を一度に消すときは止まる。意図どおりなら `--allow-mass-delete` を付ける
- 設定のページが 0 のときは、フラグを付けても止まる
- 同じマシンで 2 つの `sync` を同時に動かすと、後のほうが止まる（`.html-share/sync.lock`）

引数の前に `--` を付けない。pnpm は `--` もそのままスクリプトに渡すので、余分な引数としてエラーになる。

## 制約

- **ページは 1 ファイルで配る。** `sync` が、相対パスで読む素材を data URI にしてページに埋め込む。
  - 別のファイルとして置いた素材には署名がなく 403 になるため（署名は URL ごとの canned policy）
  - 埋め込むのは `img`・`source`・`script`・`audio`・`video`・`track`・`input` の `src`、`srcset`、`video` の `poster`、SVG の `image`・`use` の `href`、`link rel="stylesheet"`・`"icon"` の `href`、CSS（`<style>`・`style` 属性・CSS ファイル）の `url()` と `@import`
  - 埋め込める拡張子は `scripts/lib/embed.ts` の一覧にあるものだけ。素材は 1 つ 10 MiB、埋め込んだ後のページは 25 MiB まで
  - JS の中の `import` は解決しない。JS は 1 ファイルにまとめておく
  - `/` で始まるパスは使えない。ページからの相対パスにする
  - HTML は UTF-8 で書く
  - 外部の URL（CDN のライブラリ、Google Fonts、外部の画像など）は CSP で読み込めない。`sync` は警告を出して、そのまま残す
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
| `scripts/`     | CLI（keygen・sync・sign）                                          |
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
