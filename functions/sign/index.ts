// Stryker disable all: バンドルを読み込むテスト（test/infra/function-bundle.test.ts）が確かめるが、Stryker はバンドルの中の実行をこのファイルの網羅に数えられない
import { SSMClient } from "@aws-sdk/client-ssm";
import { SIGN_FUNCTION_ENV } from "../../core/names.js";
import { env } from "../env.js";
import { createSignHandler } from "../sign-request.js";
import { loadSigningKey } from "../signing-key.js";

const ssm = new SSMClient({});
const parameterName = env(SIGN_FUNCTION_ENV.parameterName);

export const handler = createSignHandler({
  distributionDomainName: env(SIGN_FUNCTION_ENV.distributionDomainName),
  keyPairId: env(SIGN_FUNCTION_ENV.keyPairId),
  loadPrivateKey: () => loadSigningKey(ssm, parameterName),
  now: () => new Date(),
});
