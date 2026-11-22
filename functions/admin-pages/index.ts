// Stryker disable all: バンドルを読み込むテスト（test/function-bundle.test.ts）が確かめるが、Stryker はバンドルの中の実行をこのファイルの網羅に数えられない
import { S3Client } from "@aws-sdk/client-s3";
import { SSMClient } from "@aws-sdk/client-ssm";
import { PAGES_PREFIX } from "../../../scripts/lib/page.js";
import { listRemote } from "../../../scripts/lib/s3-sync.js";
import { loadSigningKey } from "../../../scripts/lib/signing-key.js";
import { env } from "../../env.js";
import { ADMIN_FUNCTION_ENV } from "../../names.js";
import { createSignHandler } from "../../sign-function/sign-request.js";
import { pageEntries } from "../list-pages.js";
import { createPagesHandler } from "../pages-request.js";

const s3 = new S3Client({});
const ssm = new SSMClient({});
const bucket = env(ADMIN_FUNCTION_ENV.bucketName);
const keyParameterName = env(ADMIN_FUNCTION_ENV.signingKeyParameterName);

export const handler = createPagesHandler({
  listPages: async () => pageEntries(await listRemote(s3, bucket, PAGES_PREFIX)),
  // 署名の Lambda と同じ処理で、閲覧用の Distribution のページに署名する。
  signPage: createSignHandler({
    distributionDomainName: env(ADMIN_FUNCTION_ENV.viewerDomainName),
    keyPairId: env(ADMIN_FUNCTION_ENV.keyPairId),
    loadPrivateKey: () => loadSigningKey(ssm, keyParameterName),
    now: () => new Date(),
  }),
});
