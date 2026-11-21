// bin・lib・scripts で食い違うと、スクリプトがスタックや出力を見つけられなくなるので 1 か所で定義する。

export const STACK_NAME = "HtmlShareStack";

export const OUTPUT_KEYS = {
  bucketName: "BucketName",
  distributionDomainName: "DistributionDomainName",
  publicKeyId: "PublicKeyId",
  signFunctionName: "SignFunctionName",
} as const;

/** 署名用の秘密鍵を置く SSM のパラメータ。CloudFormation は SecureString を作れないので、keys:store で置く。 */
export const SIGNING_KEY_PARAMETER_NAME = "/html-share/signing-private-key";

/** 署名の Lambda に渡す環境変数の名前。スタックと Lambda の入口で食い違わないよう、ここで決める。 */
export const SIGN_FUNCTION_ENV = {
  distributionDomainName: "DISTRIBUTION_DOMAIN_NAME",
  keyPairId: "KEY_PAIR_ID",
  parameterName: "SIGNING_KEY_PARAMETER_NAME",
} as const;

/**
 * 署名の鍵の世代。鍵を作り直すときに 1 増やす（docs/runbook.md）。
 * CloudFront の公開鍵は中身を変えられないので、世代ごとに別の公開鍵として作る。
 */
export const SIGNING_KEY_GENERATION = 1;
