// Stryker disable all: バンドルを読み込むテスト（test/infra/function-bundle.test.ts）が確かめるが、Stryker はバンドルの中の実行をこのファイルの網羅に数えられない
import { S3Client } from "@aws-sdk/client-s3";
import { SSMClient } from "@aws-sdk/client-ssm";
import { ADMIN_FUNCTION_ENV } from "../../core/names.js";
import { PAGES_PREFIX } from "../../core/page.js";
import { listRemote } from "../../core/s3-sync.js";
import { loadSigningKey } from "../../core/signing-key.js";
import { env } from "../env.js";
import { createSignHandler } from "../sign-request.js";
import { pageEntries } from "./list-pages.js";
import { createPagesHandler } from "./pages-request.js";

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
