// bin・lib・scripts で食い違うと、スクリプトがスタックや出力を見つけられなくなるので 1 か所で定義する。

export const STACK_NAME = "HtmlShareStack";

export const OUTPUT_KEYS = {
  bucketName: "BucketName",
  distributionDomainName: "DistributionDomainName",
  publicKeyId: "PublicKeyId",
  signFunctionName: "SignFunctionName",
} as const;

/**
 * 署名用の秘密鍵を置く SSM のパラメータ。CloudFormation は SecureString を作れないので、keys:store で置く。
 * 世代ごとに分ける。deploy が途中で失敗しても、古い世代の鍵がそのまま残り、戻す作業が要らないため（ADR 10）。
 */
const SIGNING_KEY_PARAMETER_BASE = "/html-share/signing-private-key";

function assertKeyGeneration(generation: number): void {
  if (!Number.isInteger(generation) || generation < 1) {
    // Stryker disable next-line StringLiteral: 表示の文言
    throw new Error(`鍵の世代は 1 以上の整数にしてください: ${generation}`);
  }
}

export function signingKeyParameterName(generation: number): string {
  assertKeyGeneration(generation);
  return generation === 1
    ? SIGNING_KEY_PARAMETER_BASE
    : `${SIGNING_KEY_PARAMETER_BASE}-gen${generation}`;
}

/** 署名の鍵のパラメータでない名前には undefined を返す。作る側と同じ規則で確かめるため、作り直して比べる。 */
export function generationOfParameterName(name: string): number | undefined {
  // Stryker disable next-line Regex: 作り直して比べるので、$ を外しても結果は同じ
  const generation = name === SIGNING_KEY_PARAMETER_BASE ? 1 : Number(/-gen(\d+)$/.exec(name)?.[1]);
  return Number.isInteger(generation) &&
    generation >= 1 &&
    signingKeyParameterName(generation) === name
    ? generation
    : undefined;
}

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
