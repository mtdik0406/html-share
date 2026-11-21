import { createPrivateKey, createPublicKey } from "node:crypto";
import {
  GetParameterCommand,
  type GetParameterCommandOutput,
  PutParameterCommand,
} from "@aws-sdk/client-ssm";

/** SSMClient の send だけを使う。テストで偽物に差し替えるため。 */
export interface SsmSender {
  send(command: object): Promise<unknown>;
}

export interface StoreSigningKeyInput {
  parameterName: string;
  privateKeyPem: string;
  publicKeyPem: string;
  overwrite: boolean;
}

/**
 * CloudFront に登録した公開鍵と対でない秘密鍵を置くと、作った URL がすべて通らなくなる。
 * 置いてから気づくと配った URL の作り直しになるので、置く前に確かめる。
 */
function assertKeyPair(privateKeyPem: string, publicKeyPem: string): void {
  const derived = createPublicKey(createPrivateKey(privateKeyPem)).export({
    type: "spki",
    format: "der",
  });
  const registered = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  if (!derived.equals(registered)) {
    throw new Error("秘密鍵が .keys/public.pem と対になっていません");
  }
}

export async function storeSigningKey(ssm: SsmSender, input: StoreSigningKeyInput): Promise<void> {
  assertKeyPair(input.privateKeyPem, input.publicKeyPem);
  await ssm.send(
    new PutParameterCommand({
      Name: input.parameterName,
      Value: input.privateKeyPem,
      // KeyId を渡さないので、AWS 管理キー aws/ssm で暗号化される（ADR 9）。
      Type: "SecureString",
      Tier: "Standard",
      Overwrite: input.overwrite,
    }),
  );
}

export async function loadSigningKey(ssm: SsmSender, parameterName: string): Promise<string> {
  const res = (await ssm.send(
    new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
  )) as GetParameterCommandOutput;
  // Stryker disable next-line OptionalChaining: Parameter がなくても TypeError で拒むので、振る舞いは同じ
  const value = res.Parameter?.Value;
  if (!value) throw new Error(`パラメータ ${parameterName} に値がありません`);
  return value;
}
