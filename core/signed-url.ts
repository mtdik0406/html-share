import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { pageUrl } from "./page.js";

export interface SignPageUrlInput {
  distributionDomainName: string;
  slug: string;
  keyPairId: string;
  privateKey: string | Buffer;
  expiresAt: Date;
}

export function signPageUrl(input: SignPageUrlInput): string {
  // dateLessThan だけを渡すと canned policy になる。署名は渡した URL（クエリを含む）と期限に対する
  // ものなので、ほかの URL には効かない。ページを 1 ファイルで完結させるのはこのため（README の「制約」）。
  return getSignedUrl({
    url: pageUrl(input.distributionDomainName, input.slug),
    keyPairId: input.keyPairId,
    privateKey: input.privateKey,
    dateLessThan: input.expiresAt,
  });
}
