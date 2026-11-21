# 10. 鍵を作り直すときは、世代を上げて CloudFront の公開鍵を作り直させる

- 日付：2026-11-21
- 状態：採用（作り直しの順と戻し方は 0011 で置き換え）

## 状況

CloudFront の公開鍵は、作ったあと中身（encodedKey）を変えられない。同じ構成要素の ID のまま中身だけを変えると、deploy が `Invalid request provided: AWS::CloudFront::PublicKey` で失敗する（aws-cdk-lib の aws-cloudfront の README）。

[ADR 9](0009-sign-in-lambda-with-ssm-key.md) の「結果」の作り直しの順（`keygen` → `keys:store --overwrite` → `cdk deploy`）では、deploy が失敗すると、SSM は新しい秘密鍵、CloudFront は古い公開鍵のままになる。古い鍵を消していると、元に戻せない。

## 決定

- `lib/names.ts` の `SIGNING_KEY_GENERATION` を鍵の世代とし、鍵を作り直すたびに 1 増やす
- 公開鍵の構成要素の ID は、1 世代目は `SigningPublicKey`（デプロイ済みの公開鍵と同じ）、2 世代目からは `SigningPublicKeyGen<世代>` にする。キーグループと Distribution の ID は変えない
- 作り直すときは、古い鍵ペアを消さずに退避し、新しい鍵で署名できると確かめてから消す。deploy が失敗したら、古い鍵を `keys:store --overwrite` で戻す
- 手順は `docs/runbook.md` に置く。ADR 9 の「結果」の作り直しの順は、この ADR で置き換える

## 理由

- 構成要素の ID が変わると、CloudFormation は新しい公開鍵を作り、キーグループと Lambda の環境変数（Key-Pair-Id）を差し替えてから、古い公開鍵を消す
- Lambda の環境変数が変わるので、古い鍵を持った実行環境も入れ替わる

## 捨てた案

- 構成要素の ID に鍵の指紋を入れる：作り直す手作業はなくなるが、指紋を入れた最初の deploy で、今の鍵も別の ID で作り直される。Key-Pair-Id が変わり、それまでに配った URL がすべて通らなくなる
- 世代を `.keys/` などの手元のファイルに置く：テンプレートの元がリポジトリの外に出て、端末ごとに食い違う

## 結果

- 鍵を作り直すには、`SIGNING_KEY_GENERATION` を上げる変更のコミットが要る
- 新しい秘密鍵を SSM に置いてから deploy が終わるまでの間に作った URL は、通らないことがある
