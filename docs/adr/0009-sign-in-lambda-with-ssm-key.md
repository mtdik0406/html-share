# 9. 署名は Lambda が SSM の秘密鍵で行い、手元に秘密鍵を置かない

- 日付：2026-11-21
- 状態：採用（鍵を作り直す順は 0010、パラメータを 1 つにすることは 0011 で置き換え）

## 状況

署名付き URL の秘密鍵は、手元の `.keys/private.pem` にあった。手元のファイルは、AI のエージェントや誤ったコマンドで読まれたり、ほかの場所へ写されたりしうる。管理画面を作るときも、同じ鍵で署名する必要がある。

CloudFormation は SecureString のパラメータを作れない（`AWS::SSM::Parameter` の `Type` は `String` と `StringList` だけ）。

## 決定

- 秘密鍵は SSM Parameter Store の SecureString（Standard 階層）に置く。暗号化は AWS 管理キー `aws/ssm` にする
- 鍵は `pnpm run keys:store` で入れる。スクリプトは鍵をファイルから読んで SDK に直接渡し、出力・引数・テンプレートに出さない。入れる前に、秘密鍵が `.keys/public.pem` と対になっていることを確かめる。すでにある値は `--overwrite` を付けたときだけ上書きする
- 署名は Lambda が行う。Lambda は slug と期限を受け取り、slug と期限を確かめてから、SSM の鍵で canned policy の URL を作って返す。Lambda のロールに許すのは、そのパラメータの `ssm:GetParameter` だけ
- `pnpm run sign` は、手元の鍵を読まず、IAM で Lambda を呼ぶ
- 今の鍵を移す。配った URL と CloudFront の公開鍵は変わらない。Lambda で署名できると確かめたら、利用者が手元の秘密鍵を消す
- Lambda のランタイムは `nodejs26.x`（[ADR 6](0006-node-26-only.md)）。aws-cdk-lib に定数がないので名前で指定する。AWS SDK はランタイムに入っているものを使わずバンドルに含め、依存の版を手元と揃える

## 理由

- 鍵が AWS の中だけにあれば、手元のファイルからは漏れない
- `aws/ssm` は無料で、1 人で使うアカウントでは、カスタマー管理キー（月 1 ドル）でキーポリシーを絞る利点が小さい
- 期限の上限は Lambda で確かめる。呼び出し元を信じると、上限を超える URL を作れてしまう

## 捨てた案

- `sign` が SSM から鍵を読んで手元で署名する：鍵が手元のメモリとエージェントの実行環境に入る。管理画面のために Lambda を別に作ることになる
- カスタマー管理キー：費用がかかる。アカウントの IAM プリンシパルを利用者 1 人に限っている間は、`aws/ssm` との差が小さい
- 鍵を作り直す：配った URL がすべて通らなくなる

## 結果

- `aws/ssm` で暗号化した値は、同じアカウントの IAM プリンシパルなら `ssm:GetParameter` の権限だけで復号できる。アカウントに別の利用者や権限の広いロールを足すときは、カスタマー管理キーへの切り替えを考え直す
- Lambda を呼べる IAM プリンシパルは、30 日以内の URL を作れる
- 鍵を作り直すときは、`keygen` → `keys:store --overwrite` → `cdk deploy` の順にする
