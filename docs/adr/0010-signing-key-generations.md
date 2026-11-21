# 10. 鍵を作り直すときは、世代を上げて公開鍵と SSM のパラメータを新しく作る

- 日付：2026-11-21
- 状態：採用

## 状況

CloudFront の公開鍵は、作ったあと中身（encodedKey）を変えられない。同じ構成要素の ID のまま中身だけを変えると、deploy が `Invalid request provided: AWS::CloudFront::PublicKey` で失敗する（aws-cdk-lib の aws-cloudfront の README）。

[ADR 9](0009-sign-in-lambda-with-ssm-key.md) のとおり 1 つのパラメータを上書きしてから deploy すると、deploy が失敗したとき、SSM は新しい鍵、CloudFront は古い公開鍵のままになる。手元の秘密鍵は消しているので、古い鍵に戻せない。

## 決定

- `lib/names.ts` の `SIGNING_KEY_GENERATION` を鍵の世代とし、作り直すたびに 1 増やす
- 公開鍵の構成要素の ID と、秘密鍵を置く SSM のパラメータの名前を、世代から決める。1 世代目はどちらも世代を足す前と同じ（`SigningPublicKey`、`/html-share/signing-private-key`）、2 世代目からは `SigningPublicKeyGen<世代>`、`/html-share/signing-private-key-gen<世代>`。キーグループと Distribution の ID は変えない
- 署名の Lambda が読むパラメータと、ロールに許すパラメータは、スタックの世代のものだけにする
- 作り直すときは、新しい世代の名前に置き（上書きしない）、deploy で公開鍵・Key-Pair-Id・読むパラメータを同時に切り替える
- 古い世代の鍵は、新しい鍵で署名できると確かめてから `pnpm run keys:delete` で消す。デプロイ済みの世代が手元の世代と違えば消さない。片付けでは `--all` ですべて消す
- 手順は `docs/runbook.md` に置く。ADR 9 の「結果」の作り直しの順と、パラメータを 1 つにすることは、この ADR で置き換える

## 理由

- deploy が失敗して戻っても、古い世代の公開鍵とパラメータがそのまま使われる。SSM を戻す作業も、手元の古い秘密鍵も要らない
- 読むパラメータが Lambda の環境変数で変わるので、古い鍵を持った実行環境も deploy で入れ替わる
- 1 世代目の名前を変えないので、デプロイ済みの公開鍵と、置いた鍵を作り直さずに済む

## 捨てた案

- 構成要素の ID に鍵の指紋を入れる：作り直す手作業はなくなるが、指紋を入れた最初の deploy で今の鍵も作り直され、Key-Pair-Id が変わって配った URL がすべて通らなくなる
- 1 つのパラメータを上書きし、失敗したら SSM の履歴から古い版を読んで戻す：秘密鍵が手元のメモリに入る
- 世代を `.keys/` などの手元のファイルに置く：テンプレートの元がリポジトリの外に出て、端末ごとに食い違う

## 結果

- 鍵を作り直すには、`SIGNING_KEY_GENERATION` を上げる変更のコミットが要る
- 古い世代の鍵は、`keys:delete` で消すまで SSM に残る。Lambda のロールは読めないが、アカウントの IAM プリンシパルは読める
- deploy の最中の数十秒は、署名が失敗することがある
