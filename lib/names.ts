// bin・lib・scripts で食い違うと、スクリプトがスタックや出力を見つけられなくなるので 1 か所で定義する。

export const STACK_NAME = "HtmlShareStack";

export const OUTPUT_KEYS = {
  bucketName: "BucketName",
  distributionDomainName: "DistributionDomainName",
  publicKeyId: "PublicKeyId",
} as const;
