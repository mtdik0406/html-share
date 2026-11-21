# html-share

AI が作った HTML を自分の AWS に置き、期限付きの署名付き URL を持つ人にだけ見せるツール。

```
閲覧者 ──(署名付き URL)──▶ CloudFront ──(OAC)──▶ S3（非公開）
                           └ 公開鍵で署名を検証
pnpm run sign ──(IAM)──▶ Lambda ──▶ SSM（秘密鍵）
```

## 必要なもの

- Node.js（版は `.nvmrc`）と pnpm（版は `package.json` の `packageManager`）
- AWS CLI と、デプロイ先のアカウントにログインできるプロファイル

配信は CloudFront の既定のドメイン（`xxxx.cloudfront.net`）で行う。

## セットアップ

```sh
pnpm install --frozen-lockfile
pnpm run keygen                     # .keys/ に鍵ペアを作る（既存の鍵は上書きしない）
export AWS_PROFILE=<プロファイル名>
pnpm exec cdk bootstrap             # アカウントとリージョンごとに 1 回だけ
pnpm exec cdk deploy
pnpm run keys:store                 # 秘密鍵を SSM の SecureString に置く
pnpm run sign <slug> --minutes 1    # Lambda で署名できることを確かめる
```

署名は、SSM の秘密鍵を読む Lambda が行う（[ADR 9](docs/adr/0009-sign-in-lambda-with-ssm-key.md)）。`keys:store` は、秘密鍵が `.keys/public.pem` と対であることを確かめてから置き、すでにある値は上書きしない。

`sign` で URL を作れたら、`.keys/private.pem` を消す。手元から秘密鍵が漏れる経路をなくすため。`.keys/public.pem` は `cdk deploy` が読むので残す。

## ページを公開する

公開するページを `html-share.config.json`（git の対象外）に並べる。`html-share.config.example.json` を写して使う。

```json
{
  "roots": ["~/work/pages"],
  "pages": [{ "slug": "report", "source": "~/work/pages/report/index.html" }]
}
```

- `roots`：ページと素材を置いてよいディレクトリ。この外のファイルは、シンボリックリンクで指していても使わない
  - ホーム・このリポジトリ・それらの親は指定できない
  - `.` で始まる階層・`node_modules` の中のファイルと、ハードリンクは使わない
- `pages`：`slug` は URL のパスになる（英小文字・数字・ハイフン、64 文字以内）。`source` は元の HTML
- 相対パスは設定ファイルのあるディレクトリから、`~/` はホームから解決する

```sh
pnpm run sync --dry-run                 # S3 をどう変えるかだけを表示する
pnpm run sync                           # S3 を設定と同じにする
pnpm run sync --config path/to/config.json
```

`sync` は設定を正として、ページを置き、置き直し、消す（[ADR 2](docs/adr/0002-sync-deletes-unlisted-pages.md)）。

- **中身が変わったページを置き直すと、配った URL で見える中身も変わる**
- **設定に無いページは S3 から消す。** その URL はすべて 403 になる
- **取り下げた slug は 30 日使えない**（[ADR 3](docs/adr/0003-block-reuse-of-retired-slugs.md)）
- 埋め込んだ手元のファイルを、ページごとに表示する。意図しないファイルが入っていないか `--dry-run` で確かめる
- 2 ページ以上、かつ公開中の 2 割以上を一度に消すときは止まる。意図どおりなら `--allow-mass-delete` を付ける
- 設定のページが 0 のときと、ほかの `sync` が動いているときは止まる

引数の前に `--` を付けない（pnpm が `--` もスクリプトに渡し、余分な引数としてエラーになる）。

## URL を配る

```sh
pnpm run sign report                    # 7 日間有効な URL（既定）
pnpm run sign report --days 3
pnpm run sign report --minutes 1        # 期限は 1 分以上、30 日以内
```

期限と slug は Lambda が確かめる。期限内の URL を持つ人は、誰でも見られる。`sign` は URL を標準出力に出すので、AI エージェントのセッションで実行すると、その記録に残る。期限は必要な長さに絞る。

## ページの書き方

ページは 1 ファイルで配る。`sync` が、相対パスで読む素材を data URI にして埋め込む（[ADR 1](docs/adr/0001-embed-assets-as-data-uri.md)）。

- 素材はページからの相対パスで書く。`/` で始まるパスと `<base href>` は使えない
- JS の中の `import` は解決しない。JS は 1 ファイルにまとめる
- SVG の `<use>` から別ファイルの SVG は参照できない。SVG をページに直接書く
- 外部の URL（CDN のライブラリ、Google Fonts など）は読み込めない
- HTML は UTF-8 で書く
- 埋め込む属性・拡張子・大きさの上限は `scripts/lib/embed.ts` にある。埋め込めない参照には `sync` が警告を出す

ページは sandbox の中で動き、許されるのはインラインの JS の実行だけ。通信（`fetch` など）、Cookie と Storage、別タブ、フォームの送信、ダイアログ、`eval` は使えない。

## セキュリティの前提

- **信用できない JS を含むページは公開しない。** ページの JS が自分自身を外部の URL へ移動させると、署名付き URL や閲覧者の情報を渡せる。WebRTC など、CSP で止めきれない経路もある
- `roots` に書き込める人やプログラムは信頼する。読む直前の差し替えへの対策はあるが、完全ではない

## 運用

URL を止める、鍵が漏れた、依存の脆弱性をすぐ直したい、すべて片付けたい、といった場面の手順は [docs/runbook.md](docs/runbook.md) にある。

## 開発

- 作業の約束は [AGENTS.md](AGENTS.md)、設計の判断とその理由は [docs/adr/](docs/adr/) にある
- 期限と slug の規則（`scripts/lib/lifetime.ts`・`scripts/lib/page.ts`）と署名（`scripts/lib/signed-url.ts`・`scripts/lib/signing-key.ts`）は、署名の Lambda のバンドルにも入る。変えたら `pnpm exec cdk deploy` するまで、Lambda は古い規則のまま
- `pnpm run check` が、コミットの前・CI・Claude Code の作業の終わりに実行される。変異テスト（`pnpm run test:mutation`）は CI で実行する
- どれも作業ツリーのコードを実行する。信頼できない PR を取り込んだ作業ツリーでは、コミットも Claude Code での作業もしない

## 謝辞

構成は [minorun365/html-share](https://github.com/minorun365/html-share)（Apache-2.0）を参考にした。コードは独自に書いている。

## ライセンス

[MIT](LICENSE)
