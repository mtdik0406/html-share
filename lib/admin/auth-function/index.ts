// Stryker disable all: バンドルを読み込むテスト（test/function-bundle.test.ts）が確かめるが、Stryker はバンドルの中の実行をこのファイルの網羅に数えられない
import { SSMClient } from "@aws-sdk/client-ssm";
import { loadSigningKey } from "../../../scripts/lib/signing-key.js";
import { env } from "../../env.js";
import { ADMIN_FUNCTION_ENV } from "../../names.js";
import { cacheUntilFailure } from "../../sign-function/sign-request.js";
import { parseAdminConfig } from "../admin-config.js";
import { createAuthHandler } from "../auth-request.js";

const ssm = new SSMClient({});
const configParameterName = env(ADMIN_FUNCTION_ENV.configParameterName);
const keyParameterName = env(ADMIN_FUNCTION_ENV.signingKeyParameterName);

async function postForm(url: string, params: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    // トークンのエンドポイントが別の場所へ送り返しても、ついて行かない。
    redirect: "error",
  });
  // 失敗の応答（invalid_grant など）にも JSON が返る。id_token がなければ、呼び出し側が拒む。
  return res.json();
}

export const handler = createAuthHandler({
  loadConfig: cacheUntilFailure(async () =>
    parseAdminConfig(await loadSigningKey(ssm, configParameterName)),
  ),
  region: env("AWS_REGION"),
  ownerEmail: env(ADMIN_FUNCTION_ENV.ownerEmail),
  keyPairId: env(ADMIN_FUNCTION_ENV.keyPairId),
  loadPrivateKey: cacheUntilFailure(() => loadSigningKey(ssm, keyParameterName)),
  postForm,
  now: () => new Date(),
});
