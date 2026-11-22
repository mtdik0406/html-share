import { InvokeCommand, type InvokeCommandOutput } from "@aws-sdk/client-lambda";
import type { SignRequest, SignResult } from "../../core/api-types.js";

/** LambdaClient の send だけを使う。テストで偽物に差し替えるため。 */
export interface LambdaSender {
  send(command: object): Promise<unknown>;
}

// Stryker disable BlockStatement: catch を空にしても undefined を返すので、振る舞いは同じ
function decodePayload(payload: Uint8Array | undefined): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return undefined;
  }
}
// Stryker restore BlockStatement

function isSignResult(value: unknown): value is SignResult {
  const fields = value as Record<string, unknown> | null | undefined;
  // Stryker disable next-line OptionalChaining: null を読んでも TypeError で拒むので、振る舞いは同じ
  return typeof fields?.url === "string" && typeof fields?.expiresAt === "string";
}

/** 期限の上限と slug は Lambda が確かめる（ADR 9）。ここで確かめても、Lambda を直接呼べば越えられるため。 */
export async function requestSignedUrl(
  lambda: LambdaSender,
  functionName: string,
  request: SignRequest,
): Promise<SignResult> {
  const res = (await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      Payload: new TextEncoder().encode(JSON.stringify(request)),
    }),
  )) as InvokeCommandOutput;
  const body = decodePayload(res.Payload);

  // Lambda の中の例外は、呼び出し自体は成功し、FunctionError と本文の errorMessage で返る。
  if (res.FunctionError !== undefined) {
    // Stryker disable next-line all: 表示の文言。理由を利用者に見せるためだけに使う
    const message = (body as { errorMessage?: unknown } | undefined)?.errorMessage;
    // Stryker disable next-line all: 表示の文言
    throw new Error(
      `署名に失敗しました: ${typeof message === "string" ? message : res.FunctionError}`,
    );
  }
  if (!isSignResult(body)) throw new Error("署名の Lambda が URL を返しませんでした");
  return { url: body.url, expiresAt: body.expiresAt };
}
