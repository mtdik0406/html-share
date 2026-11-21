# html-share

AI が作った HTML を自分の AWS に置き、期限付きの署名付き URL を持つ人にだけ見せるツール。

```
閲覧者 ──(署名付き URL)──▶ CloudFront ──(OAC)──▶ S3（非公開）
                           └ 公開鍵で署名を検証
```

## 必要なもの

- Node.js 26 以降（`.nvmrc`）と pnpm（バージョンは `package.json` の `packageManager`）
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
  - ホーム・このリポジトリ・それらの親（`/` など）は指定できない。鍵や設定まで公開できる範囲になるため
  - `roots` の中でも、`.` で始まる階層（`.git`・`.config` など）と `node_modules` の中のファイル、ハードリンクは使わない
  - `roots` に書き込める人やプログラムは信頼する前提。読む直前に差し替えられることへの対策はあるが、完全ではない
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

- 設定にあり S3 に無いページを置く（計画の表示は `add`）
- 中身が変わったページを置き直す（`update`）。**配布済みの URL で見える中身も変わる**
- 中身が同じページは送らない
- 埋め込んだ手元のファイルを、ページごとに表示する。意図しないファイルが入っていないか `--dry-run` で確かめる
- **設定に無いページは S3 から消す。** 配布済みの URL を止める手段はこれしかない（署名付き URL は個別に取り消せない）
- **取り下げた slug は、30 日間使えない。** 取り下げる前に配った URL で、新しいページが見えてしまうため。消した slug と時刻は `.html-share/retired.json` に残る（消すとこの歯止めが効かなくなる）。別のマシンで取り下げた slug は分からない
- 2 ページ以上、かつ公開中のページの 2 割以上を一度に消すときは止まる。意図どおりなら `--allow-mass-delete` を付ける
- 設定のページが 0 のときは、フラグを付けても止まる
- 同じマシンで 2 つの `sync` を同時に動かすと、後のほうが止まる（`.html-share/sync.lock`）

引数の前に `--` を付けない。pnpm は `--` もそのままスクリプトに渡すので、余分な引数としてエラーになる。

## 制約

- **ページは 1 ファイルで配る。** `sync` が、相対パスで読む素材を data URI にしてページに埋め込む。
  - 別のファイルとして置いた素材には署名がなく 403 になるため（署名は URL ごとの canned policy）
  - 対象の属性・拡張子・大きさの上限は `scripts/lib/embed.ts` にある。対象外の相対パスと外部の URL には、`sync` が警告を出す
  - JS の中の `import` は解決しない。JS は 1 ファイルにまとめておく
  - SVG の `<use>` から別ファイルの SVG は参照できない（ブラウザが data URI を描画しない）。SVG をページに直接書く
  - `/` で始まるパスは使えない。ページからの相対パスにする
  - `<base href>` は使えない。配信時は CSP で無効になり、手元と参照先が変わるため
  - HTML は UTF-8 で書く
  - 外部の URL（CDN のライブラリ、Google Fonts など）は CSP で読み込めない
- **ページは sandbox の中で動き、許されるのはインラインの JS の実行だけ。** 設定は `lib/html-share-stack.ts` の Content-Security-Policy。
  - 通信（`fetch` など）、Cookie と Storage、別タブ、フォームの送信、ダイアログ、`eval` は使えない
- **外への持ち出しは減らしているが、ゼロではない。** 信用できない JS を含むページは公開しない。
  - ページの JS が自分自身を外部の URL へ移動させると、そのページの署名付き URL や閲覧者の情報を渡せる。ヘッダーでは止められない
  - WebRTC など、CSP で止めきれない通信の経路がある（ブラウザによって異なる）
- 応答には `Cache-Control: no-store`・`X-Robots-Tag: noindex`・`Referrer-Policy: no-referrer` も付く。期限切れの URL をブラウザのキャッシュで見せず、署名付き URL を Referer で外部に渡さないため。
- 期限内の署名付き URL を持つ人は誰でも見られる。渡す相手と期限で管理する。
  - `sign` は URL を標準出力に出す。AI エージェントのセッションで実行すると、その記録に残る。期限は必要な長さに絞る

## 開発

作業の約束は [AGENTS.md](AGENTS.md)、設計の判断とその理由は [docs/adr/](docs/adr/) にある。`pnpm run check` が、コミットの前（`.githooks/`）・CI・Claude Code の作業の終わり（`.claude/`）で実行される。変異テスト（`pnpm run test:mutation`）は CI で実行し、スコアが `stryker.config.json` の `break` を下回ると落ちる。どれも作業ツリーのコードを実行するので、信頼できない PR を取り込んだ作業ツリーでは、コミットも Claude Code での作業もしない。

## 依存の更新

公開から 14 日たっていない版は入れない（`pnpm-workspace.yaml` の `minimumReleaseAge`）。乗っ取られた版は数日で見つかり、取り下げられることが多いため。

脆弱性の修正版を 14 日待てないときだけ、その版を例外にする。

1. `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` に、パッケージ名と版を書く（例：`"@aws-sdk/client-s3@3.2000.1"`）。名前だけで書くと、以後のすべての版が下限なしで入るので書かない
2. `pnpm install` が、修正版の依存（間接の依存）の若い版で止まったら、その版も同じように足す
3. 14 日たったら、足した行を消す

脆弱性の勧告は、GitHub の Dependabot のアラートで知らせる。

## 片付け

```sh
pnpm exec cdk destroy   # バケットの中身ごと消える
```

## 謝辞

構成は [minorun365/html-share](https://github.com/minorun365/html-share)（Apache-2.0）を参考にした。コードは独自に書いている。

## ライセンス

[MIT](LICENSE)
