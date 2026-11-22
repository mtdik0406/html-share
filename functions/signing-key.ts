import { GetParameterCommand, type GetParameterCommandOutput } from "@aws-sdk/client-ssm";

/** SSMClient の send だけを使う。テストで偽物に差し替えるため。 */
export interface SsmSender {
  send(command: object): Promise<unknown>;
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
