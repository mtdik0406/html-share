#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { App } from "aws-cdk-lib";
import { cognitoDomainPrefix as cognitoDomainPrefixOf } from "../lib/cognito-prefix.js";
import { HtmlShareStack } from "../lib/html-share-stack.js";
import { SIGNING_KEY_GENERATION, STACK_NAME } from "../lib/names.js";
import { PUBLIC_KEY_PATH } from "../scripts/lib/paths.js";

// 秘密鍵はここで読まない。CDK に渡した値はテンプレートに入り、AWS に送られるため。
if (!existsSync(PUBLIC_KEY_PATH)) {
  console.error(
    "公開鍵 .keys/public.pem がありません。先に pnpm run keygen で鍵ペアを作ってください",
  );
  process.exit(1);
}
const publicKeyPem = readFileSync(PUBLIC_KEY_PATH, "utf8");

// 管理画面に入れる人のメールアドレス。リポジトリに書かないよう、deploy のときに渡す（ADR 13）。
const ownerEmail = process.env.HTML_SHARE_OWNER_EMAIL;
if (!ownerEmail) {
  console.error(
    "管理画面に入る人のメールアドレスを、環境変数 HTML_SHARE_OWNER_EMAIL で渡してください",
  );
  process.exit(1);
}
const account = process.env.CDK_DEFAULT_ACCOUNT;
if (!account) {
  console.error("AWS のアカウントが分かりません。AWS_PROFILE を指定してください");
  process.exit(1);
}
const cognitoDomainPrefix = cognitoDomainPrefixOf(account);

const app = new App();

new HtmlShareStack(app, STACK_NAME, {
  // リポジトリにアカウント ID を書かないよう、実行時のプロファイル（AWS_PROFILE）から取る。
  env: {
    account,
    region: process.env.CDK_DEFAULT_REGION,
  },
  publicKeyPem,
  signingKeyGeneration: SIGNING_KEY_GENERATION,
  admin: { ownerEmail, cognitoDomainPrefix },
});
