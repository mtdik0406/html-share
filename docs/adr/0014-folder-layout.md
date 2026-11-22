# 14. コードを、使う場所ごとのディレクトリに分け、依存の向きを検査する

- 日付：2026-11-22
- 状態：採用

## 状況

コードは `scripts/`（CLI）・`lib/`（CDK・Lambda・管理画面のブラウザのコード）・`bin/`・`tools/` にあった。

- ページ・期限・署名の規則が `scripts/lib/` にあり、`lib/` の 10 か所が `../../scripts/lib` を読んでいた。どこからも使う規則が、CLI の下にあった
- `lib/` に、CDK・Lambda・ブラウザのコードが混ざっていた。ブラウザのコードの `/// <reference lib="dom" />` はプログラム全体に効き、CLI や Lambda のコードでも `HTMLElement` などの DOM の型が通っていた（`scripts/lib/` に DOM の型を使うファイルを置き、`tsc --noEmit` が通ることを確かめた）
- `test/` は平らで、変異テストの範囲（[ADR 11](0011-review-and-mutation-scope.md)）はテストとソースをファイル名だけで対応させていた。同じ名前のファイルが別のディレクトリに増えると、対応が決まらない

## 決定

### ディレクトリ

| ディレクトリ | 置くもの                                                                                 | 読んでよい所          |
| ------------ | ---------------------------------------------------------------------------------------- | --------------------- |
| `core/`      | 2 か所以上から使う規則と、その間の取り決め（ページ・期限・署名・鍵・S3・名前・API の型） | `core/`               |
| `cli/`       | 手元で実行するコマンド（入口は直下、中身は `cli/lib/`）                                  | `core/`・`cli/`       |
| `functions/` | Lambda（`sign/`・`admin-auth/`・`admin-pages/`）と、その間で使うもの                     | `core/`・`functions/` |
| `infra/`     | CDK のスタックと構成要素                                                                 | `core/`・`infra/`     |
| `admin-ui/`  | 管理画面のブラウザのコード                                                               | `core/`・`admin-ui/`  |
| `bin/`       | CDK の入口                                                                               | `core/`・`infra/`     |
| `tools/`     | 検査と作業の手順のスクリプト                                                             | `tools/`              |
| `test/`      | テスト。ソースと同じ形に並べる（`core/page.ts` のテストは `test/core/page.test.ts`）     | どこでも              |

- 「読んでよい所」は、相対パスの import・export ... from・import() を対象に、`pnpm run lint:repo` が検査する。型だけの import も同じに扱う
- 2 か所以上が使う型（管理画面の設定 `AdminConfig`、API の応答 `PageEntry`・`SignResult`）は `core/` に置く。`infra/` と `functions/`、`admin-ui/` と `functions/` が互いに読まずに済むようにするため
- CDK が Lambda をまとめるときの入口と、管理画面の静的ファイルは、`infra/` から `new URL(..., import.meta.url)` で場所を指す。import ではないので、上の検査の対象にしない

### 型検査

- `admin-ui/` は、DOM の型を使い Node の型を使わない専用の `admin-ui/tsconfig.json` で検査する。ほかはこれまでの `tsconfig.json` で、`admin-ui/` を含めない
- `pnpm run typecheck` が両方を流す

### テストとソースの対応

- `test/<パス>.test.ts` は `<パス>.ts` のテストとする。変異テストの範囲（`pnpm run test:mutation:scope`）は、この対応で、変えたテストに対応するソースを選ぶ。対応するソースがないテストを変えたときは、これまでどおり全体を流す。ADR 11 の「同じ名前のソース」を、この対応で置き換える

## 理由

- 規則を `core/` に置き、`core/` がほかを読まないことを検査すると、規則を変えたときに影響する範囲が import から分かる。CLI の中身を変えても、Lambda に入る規則を変えたことにならない
- ブラウザのコードだけ別の tsconfig にすると、DOM の型が CLI と Lambda に、Node の型が管理画面に入らない。管理画面のコードが Node にしかない API（`Buffer` など）を使ったら、型検査で落ちる
- テストの場所でソースが決まると、ファイル名の重複を気にせずに置ける

## 捨てた案

- 依存の向きを dependency-cruiser などのツールで検査する：依存が 1 つ増える。相対パスの import を見るだけなら、`lint:repo` が使っている TypeScript の構文木で足りる
- 型だけの import は、向きの検査から外す：`admin-ui/` の型検査が、型の先のファイルを読み込み、そこから Node の型を要求する。型を `core/` に置くほうが、検査が 1 種類で済む
- `scripts/` と `lib/` の名前を残し、中だけを分ける：`lib/` に置くものの基準が決まらず、また混ざる

## 結果

- 採用済みの ADR の中のパス（`scripts/lib/...`・`lib/...`）は、決めた時点の記録として書き換えない
- `core/` の規則（ページ・期限・署名・鍵・S3・名前）は Lambda のバンドルにも入る。変えたら `pnpm exec cdk deploy` するまで、Lambda は古い規則のまま
- 新しいディレクトリを足すときは、`lint:repo` の依存の向きの表と、検査の設定（`tsconfig.json`・`knip.jsonc`・`stryker.config.json`・`package.json` の網羅率と重複の対象・`review:scope` の範囲）を合わせて直す
