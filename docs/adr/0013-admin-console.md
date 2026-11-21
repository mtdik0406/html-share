# 13. 管理画面は別の Distribution に置き、Cognito のパスキーで入って署名付き Cookie で守る

- 日付：2026-11-22
- 状態：採用

## 状況

URL を発行するには、手元で `pnpm run sign` を実行するしかない。スマートフォンなど、リポジトリのない端末からは、ページの一覧も見られず、URL も発行できない。

閲覧用の Distribution は、ページごとの署名付き URL がなければ何も返さない。ページは自分以外が書いた HTML なので、sandbox の CSP で閉じ込めている。管理画面は、同じオリジンで Cookie と JavaScript を使う必要があり、閲覧用と同じ CSP では動かない。

Cognito のパスキーは、Lite 以外のプランで、choice-based のサインインでだけ使える。classic hosted UI では使えない。パスキーだけをサインインの方式にすることはできず、ほかの方式を少なくとも 1 つ並べる必要がある。

## 決定

### 範囲

- 管理画面でできるのは、ページの一覧を見ることと、ページの署名付き URL を発行することだけにする。ページを置く・消す操作は、これまでどおり手元の `sync` だけで行う
- 受信箱（PC のエージェントとスマートフォンの本人のやりとり）は作らない。DynamoDB も作らない。受信箱を作るときに、別の ADR で足す

### 配置

- 管理画面には、閲覧用とは別の CloudFront Distribution を作る。同じスタックに置く
- 画面の静的ファイルは、ページのバケットとは別のバケットに置く。`sync` が消す対象と混ざらないようにするため
- パスごとに CloudFront のビヘイビアと Lambda を分ける

| パス             | オリジン                                      | 署名の要否               |
| ---------------- | --------------------------------------------- | ------------------------ |
| `/auth/*`        | 認証の Lambda（Function URL と OAC）          | 不要（サインインの入口） |
| `/api/pages/*`   | ページの API の Lambda（Function URL と OAC） | 署名付き Cookie が要る   |
| 上記以外（`/*`） | 画面のバケット（OAC）                         | 署名付き Cookie が要る   |

- Function URL の認証は `AWS_IAM` にし、CloudFront の OAC からだけ呼べるようにする。CloudFront を経由しない呼び出しは通さない
- OAC で Function URL に POST するときは、本文の SHA-256 を `x-amz-content-sha256` ヘッダーに入れる必要がある。画面の JavaScript が付ける

### サインイン

- Cognito のユーザープールは Essentials のプランにする。自分でのサインアップは無効にし、使う人 1 人だけをスタックで作る。その人のメールアドレスはリポジトリに書かず、deploy のときに渡す
- サインインの画面は managed login（version 2）にする。CDK でアプリクライアントを作っても branding は作られず、managed login が使えないので、branding もスタックで作る
- サインインの方式は、パスキーとパスワードの 2 つにする。パスキーの user verification は `required` にする
- MFA は必須にし、方式は TOTP にする。パスキーの FactorConfiguration は `MULTI_FACTOR_WITH_USER_VERIFICATION` にする。user verification 付きのパスキーは MFA を満たすので、パスキーはそれだけで通り、パスワードのときは TOTP も求める
- パスキーの RP ID は、ユーザープールの prefix domain（`<prefix>.auth.<region>.amazoncognito.com`）にする。prefix はスタックで決め、アカウントごとに変わる値をリポジトリに書かない
- アプリクライアントは、クライアントシークレットを持たない public client にし、認可コードと PKCE を使う。コードとトークンの交換は認証の Lambda が行う
- 認証の Lambda は、受け取った ID トークンのメールアドレスが deploy のときに渡したものと一致し、`email_verified` が真であることを確かめてから、Cookie を発行する

### 署名付き Cookie

- custom policy の Resource は `https://<管理画面のドメイン>/*` にする。ドメインを入れるので、この Cookie では閲覧用の Distribution のページは開けない
- 署名には、閲覧用と同じ鍵の世代（[ADR 10](0010-signing-key-generations.md)）の SSM の秘密鍵（[ADR 9](0009-sign-in-lambda-with-ssm-key.md)）を使い、管理画面の Distribution も同じ KeyGroup を信頼する
- Cookie の期限は 1 日にする
- Cookie には `Secure`・`HttpOnly`・`SameSite=Lax` を付ける。Cognito から戻ってくるリダイレクトはサイトをまたぐので、`Strict` にすると、戻った直後の要求に Cookie が付かない
- 状態を変える API は POST だけにし、GET では状態を変えない。`SameSite=Lax` の Cookie は、ほかのサイトからの POST には付かない

### API

- 一覧は、バケットの `pages/` を S3 から読む。手元の設定ファイルは読まない
- URL の発行は、署名の Lambda と同じ処理（slug と期限の確かめ方と上限）を使う
- ページの API の Lambda に許すのは、バケットの `pages/` の一覧と、鍵のパラメータの `ssm:GetParameter` だけにする。書き込みと削除は許さない
- 認証の Lambda に許すのは、鍵のパラメータの `ssm:GetParameter` だけにする

### 画面の応答ヘッダー

- 閲覧用とは別の ResponseHeadersPolicy を作る。CSP は `default-src 'self'` を基本にして、インラインのスクリプトは許さない。HSTS・`no-store`・`noindex`・`no-referrer`・フレームへの埋め込みの禁止は、閲覧用と同じにする
- パスキーの登録とサインインは Cognito のドメインで行うので、管理画面の Permissions-Policy では `publickey-credentials-*` を止めたままにする

## 理由

- Distribution を分ければ、ページの HTML と管理画面が別のオリジンになり、ページから管理画面の Cookie や API に触れない。閲覧用の CSP も緩めずに済む
- パスごとに Lambda を分ければ、Lambda ごとのロールを、そのパスで使う操作だけに絞れる
- 管理画面は書き込みの権限を持たないので、Cookie が盗まれても、ページの中身は変えられない
- 鍵を分けると、鍵の置き場所・世代・作り直しの手順が 2 組になる。管理画面は閲覧用の URL を発行できるので、鍵を分けても守れる範囲は広がらない
- managed login を使えば、パスキーの登録とサインインの画面を作らずに済む
- public client と PKCE にすれば、クライアントシークレットの置き場所が要らない
- MFA を必須にしないと、パスワードだけで入れてしまい、パスキーに user verification を求める意味が薄れる
- Cookie は取り消せないので、盗まれたときに使える期間を短くする。パスキーなら、サインインし直す手間は小さい

## 捨てた案

- 閲覧用の Distribution にパスを足す：ページの HTML と管理画面が同じオリジンになる。閲覧用の CSP を、パスごとに分ける必要がある
- API を 1 つの Lambda にまとめる：一覧と発行と認証の権限を、1 つのロールに足し合わせることになる
- 画面を自分で作り、SDK でパスキーを扱う：登録とサインインの画面を作って保つ手間が増える。RP ID は管理画面のドメインにできるが、独自ドメインに移るときに登録し直すことは変わらない
- パスキーと並べる方式をメールの OTP にする：SES の設定が要るかは未確認。OTP は MFA を必須にしたユーザープールでは使えない
- クライアントシークレットを持つ confidential client：シークレットを Lambda に渡す置き場所が要る
- MFA を任意にする：パスワードだけで入れる
- Cookie の期限を 30 日にする：盗まれた Cookie を 30 日使える

## 結果

- 独自ドメインに移ると RP ID が変わり、パスキーを登録し直す必要がある
- 鍵の世代を上げると、閲覧用の URL と同時に、管理画面の Cookie もすべて通らなくなる。サインインし直せば戻る
- 署名付き Cookie は、期限までは取り消せない。サインアウトは手元の Cookie を消すだけで、盗まれた Cookie は期限まで使える。取り消すには、鍵の世代を上げる
- アプリクライアントのコールバック URL は、管理画面の Distribution のドメインに依存する。Distribution は Lambda の Function URL に依存し、Lambda はアプリクライアントの ID とドメインを使う。この循環を、Lambda が設定を SSM の String パラメータから実行時に読むことで断つ見込み（未確認。実装の最初に `cdk synth` で確かめる）
- スタックのテストは Distribution が 1 つの前提なので、閲覧用の Distribution に絞って書き直す
- Cognito の料金は、月ごとのアクティブなユーザー数で決まる。使うのは 1 人なので、料金が出るかは実装の前に料金ページで確かめる
- パスワードでサインインするときは、TOTP のアプリが要る
