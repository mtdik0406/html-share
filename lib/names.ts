// bin・lib・scripts で食い違うと、スクリプトがスタックや出力を見つけられなくなるので 1 か所で定義する。

export const STACK_NAME = "HtmlShareStack";

export const OUTPUT_KEYS = {
  bucketName: "BucketName",
  distributionDomainName: "DistributionDomainName",
  publicKeyId: "PublicKeyId",
} as const;

/** 署名用の秘密鍵を置く SSM のパラメータ。CloudFormation は SecureString を作れないので、keys:store で置く。 */
export const SIGNING_KEY_PARAMETER_NAME = "/html-share/signing-private-key";
