import { createPrivateKey, createPublicKey } from "node:crypto";
import {
  GetFunctionConfigurationCommand,
  type GetFunctionConfigurationCommandOutput,
} from "@aws-sdk/client-lambda";
import {
  DeleteParametersCommand,
  type DeleteParametersCommandOutput,
  DescribeParametersCommand,
  type DescribeParametersCommandOutput,
  GetParameterCommand,
  type GetParameterCommandOutput,
  PutParameterCommand,
} from "@aws-sdk/client-ssm";
import {
  generationOfParameterName,
  SIGN_FUNCTION_ENV,
  signingKeyParameterName,
} from "../../lib/names.js";

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

/** 消すパラメータを選ぶ。all でなければ、今の世代より前の世代だけを選び、今の鍵と、先に置いた次の世代の鍵は残す。 */
export function selectKeysToDelete(
  names: readonly string[],
  currentGeneration: number,
  all: boolean,
): string[] {
  return names.filter((name) => {
    const generation = generationOfParameterName(name);
    return generation !== undefined && (all || generation < currentGeneration);
  });
}

/** 名前が署名の鍵の形をしたパラメータを、すべて返す。 */
export async function listSigningKeys(ssm: SsmSender): Promise<string[]> {
  const names: string[] = [];
  let token: string | undefined;
  do {
    const res = (await ssm.send(
      new DescribeParametersCommand({
        // 1 世代目の名前が、ほかの世代の名前の先頭になっている。
        ParameterFilters: [
          { Key: "Name", Option: "BeginsWith", Values: [signingKeyParameterName(1)] },
        ],
        NextToken: token,
      }),
    )) as DescribeParametersCommandOutput;
    // Stryker disable next-line ArrayDeclaration: 名前のない要素は飛ばすので、既定の配列に何が入っても同じ
    for (const { Name } of res.Parameters ?? []) {
      if (Name !== undefined && generationOfParameterName(Name) !== undefined) names.push(Name);
    }
    token = res.NextToken;
  } while (token !== undefined);
  return names;
}

/** DeleteParameters が 1 回で受け付ける名前の上限。 */
const DELETE_BATCH_SIZE = 10;

export async function deleteSigningKeys(ssm: SsmSender, names: readonly string[]): Promise<void> {
  const failed: string[] = [];
  for (let i = 0; i < names.length; i += DELETE_BATCH_SIZE) {
    const res = (await ssm.send(
      new DeleteParametersCommand({ Names: names.slice(i, i + DELETE_BATCH_SIZE) }),
    )) as DeleteParametersCommandOutput;
    failed.push(...(res.InvalidParameters ?? []));
  }
  if (failed.length > 0) throw new Error(`消せなかったパラメータ: ${failed.join(", ")}`);
}

export interface KeysDeleteDeps {
  ssm: SsmSender;
  currentGeneration: number;
  /** デプロイ済みのスタックが使う世代。読めなければ undefined。 */
  deployedGeneration: () => Promise<number | undefined>;
  log: (line: string) => void;
}

export async function runKeysDelete(
  deps: KeysDeleteDeps,
  options: { all: boolean; dryRun: boolean },
): Promise<string[]> {
  // 世代が正しくなければ、ここで失敗する。
  signingKeyParameterName(deps.currentGeneration);
  // 手元の世代だけで決めると、deploy が失敗して戻ったあとに、スタックが使っている鍵を消してしまう。
  if (!options.all) {
    const deployed = await deps.deployedGeneration();
    if (deployed !== deps.currentGeneration) {
      throw new Error(
        `デプロイ済みの鍵の世代（${deployed ?? "不明"}）が、手元の世代（${deps.currentGeneration}）と違います。消しません`,
      );
    }
  }
  const names = selectKeysToDelete(
    await listSigningKeys(deps.ssm),
    deps.currentGeneration,
    options.all,
  );
  // Stryker disable next-line StringLiteral,CallExpression: 表示だけで、消す対象は戻り値で確かめる
  for (const name of names) deps.log(`delete ${name}`);
  if (!options.dryRun) await deleteSigningKeys(deps.ssm, names);
  return names;
}

/** LambdaClient の send だけを使う。テストで偽物に差し替えるため。 */
export interface LambdaConfigSender {
  send(command: object): Promise<unknown>;
}

export async function readDeployedKeyGeneration(
  lambda: LambdaConfigSender,
  functionName: string,
): Promise<number | undefined> {
  const res = (await lambda.send(
    new GetFunctionConfigurationCommand({ FunctionName: functionName }),
  )) as GetFunctionConfigurationCommandOutput;
  // Stryker disable next-line OptionalChaining: 環境変数がなくても TypeError で失敗し、消さないので、振る舞いは同じ
  const name = res.Environment?.Variables?.[SIGN_FUNCTION_ENV.parameterName];
  return name === undefined ? undefined : generationOfParameterName(name);
}
