// Stryker disable all: バンドルを読み込むテスト（test/infra/function-bundle.test.ts）が確かめるが、Stryker はバンドルの中の実行をこのファイルの網羅に数えられない
import { SSMClient } from "@aws-sdk/client-ssm";
import { ADMIN_FUNCTION_ENV } from "../../core/names.js";
import { loadSigningKey } from "../../core/signing-key.js";
import { env } from "../env.js";
import { cacheUntilFailure } from "../sign/sign-request.js";
import { createConfigLoader, createPostForm } from "./auth-io.js";
import { createAuthHandler } from "./auth-request.js";

const ssm = new SSMClient({});
const configParameterName = env(ADMIN_FUNCTION_ENV.configParameterName);
const keyParameterName = env(ADMIN_FUNCTION_ENV.signingKeyParameterName);

export const handler = createAuthHandler({
  loadConfig: createConfigLoader(ssm, configParameterName),
  region: env("AWS_REGION"),
  ownerEmail: env(ADMIN_FUNCTION_ENV.ownerEmail),
  keyPairId: env(ADMIN_FUNCTION_ENV.keyPairId),
  loadPrivateKey: cacheUntilFailure(() => loadSigningKey(ssm, keyParameterName)),
  postForm: createPostForm(fetch),
  now: () => new Date(),
});
