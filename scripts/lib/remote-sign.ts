import { InvokeCommand, type InvokeCommandOutput } from "@aws-sdk/client-lambda";

/** LambdaClient の send だけを使う。テストで偽物に差し替えるため。 */
export interface LambdaSender {
  send(command: object): Promise<unknown>;
}

export interface RemoteSignRequest {
  slug: string;
  lifetimeMs: number;
}

export interface RemoteSignResult {
  url: string;
  expiresAt: string;
}

function decodePayload(payload: Uint8Array | undefined): unknown {
  if (payload === undefined) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return undefined;
  }
}

function isSignResult(value: unknown): value is RemoteSignResult {
  if (typeof value !== "object" || value === null) return false;
  const { url, expiresAt } = value as Record<string, unknown>;
  return typeof url === "string" && typeof expiresAt === "string";
}

/** 期限の上限と slug は Lambda が確かめる（ADR 9）。ここで確かめても、Lambda を直接呼べば越えられるため。 */
export async function requestSignedUrl(
  lambda: LambdaSender,
  functionName: string,
  request: RemoteSignRequest,
): Promise<RemoteSignResult> {
  const res = (await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      Payload: new TextEncoder().encode(JSON.stringify(request)),
    }),
  )) as InvokeCommandOutput;
  const body = decodePayload(res.Payload);

  // Lambda の中の例外は、呼び出し自体は成功し、FunctionError と本文の errorMessage で返る。
  if (res.FunctionError !== undefined) {
    const message = (body as { errorMessage?: unknown } | undefined)?.errorMessage;
    throw new Error(
      `署名に失敗しました: ${typeof message === "string" ? message : res.FunctionError}`,
    );
  }
  if (!isSignResult(body)) throw new Error("署名の Lambda が URL を返しませんでした");
  return { url: body.url, expiresAt: body.expiresAt };
}
