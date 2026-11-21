// Stryker disable all: バンドルを読み込むテスト（test/sign-function-bundle.test.ts）が確かめるが、Stryker はバンドルの中の実行をこのファイルの網羅に数えられない
import { SSMClient } from "@aws-sdk/client-ssm";
import { loadSigningKey } from "../../scripts/lib/signing-key.js";
import { SIGN_FUNCTION_ENV } from "../names.js";
import { createSignHandler } from "./sign-request.js";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`環境変数 ${name} がありません`);
  return value;
}

const ssm = new SSMClient({});
const parameterName = env(SIGN_FUNCTION_ENV.parameterName);

export const handler = createSignHandler({
  distributionDomainName: env(SIGN_FUNCTION_ENV.distributionDomainName),
  keyPairId: env(SIGN_FUNCTION_ENV.keyPairId),
  loadPrivateKey: () => loadSigningKey(ssm, parameterName),
  now: () => new Date(),
});
