// Lambda Function URL のペイロード（形式 2.0）のうち、使う項目だけを型にする。
// https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html

export interface UrlRequest {
  rawPath: string;
  rawQueryString?: string;
  cookies?: string[];
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
}

export interface UrlResponse {
  statusCode: number;
  headers?: Record<string, string>;
  cookies?: string[];
  body?: string;
}

export function json(statusCode: number, value: unknown): UrlResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(value),
  };
}

export function bodyText(request: UrlRequest): string {
  // Stryker disable next-line StringLiteral: 本文がなければ、既定の文字列が何でも JSON として読めず 400 になるので、振る舞いは同じ
  const body = request.body ?? "";
  return request.isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
}
