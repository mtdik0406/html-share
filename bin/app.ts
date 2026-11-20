#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { App } from "aws-cdk-lib";
import { HtmlShareStack } from "../lib/html-share-stack.js";
import { STACK_NAME } from "../lib/names.js";
import { PUBLIC_KEY_PATH } from "../scripts/lib/paths.js";

// 秘密鍵はここで読まない。CDK に渡した値はテンプレートに入り、AWS に送られるため。
if (!existsSync(PUBLIC_KEY_PATH)) {
  console.error(
    "公開鍵 .keys/public.pem がありません。先に pnpm run keygen で鍵ペアを作ってください",
  );
  process.exit(1);
}
const publicKeyPem = readFileSync(PUBLIC_KEY_PATH, "utf8");

const app = new App();

new HtmlShareStack(app, STACK_NAME, {
  // リポジトリにアカウント ID を書かないよう、実行時のプロファイル（AWS_PROFILE）から取る。
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  publicKeyPem,
});
