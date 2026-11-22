import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { type LambdaSender, requestSignedUrl } from "../../../cli/lib/remote-sign.js";

const FUNCTION = "html-share-sign";
const REQUEST = { slug: "page-a", lifetimeMs: 60_000 };
const RESULT = {
  url: "https://d111.cloudfront.net/pages/page-a/index.html?x=1",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function fakeLambda(response: object) {
  const sent: object[] = [];
  const lambda: LambdaSender = {
    async send(command) {
      sent.push(command);
      return response;
    },
  };
  return { lambda, sent };
}

describe("requestSignedUrl", () => {
  it("slug と期限を Lambda に渡し、返った URL と期限を返す", async () => {
    const { lambda, sent } = fakeLambda({ StatusCode: 200, Payload: encode(RESULT) });
    assert.deepEqual(await requestSignedUrl(lambda, FUNCTION, REQUEST), RESULT);
    assert.equal(sent.length, 1);
    const [command] = sent;
    assert.ok(command instanceof InvokeCommand);
    assert.equal(command.input.FunctionName, FUNCTION);
    assert.deepEqual(
      JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array)),
      REQUEST,
    );
  });

  it("Lambda の中で失敗したら、失敗として伝える", async () => {
    const { lambda } = fakeLambda({
      StatusCode: 200,
      FunctionError: "Unhandled",
      Payload: encode({ errorType: "Error", errorMessage: "slug は..." }),
    });
    await assert.rejects(requestSignedUrl(lambda, FUNCTION, REQUEST));
  });

  it("Lambda が失敗を返したら、本文が URL の形でも失敗として伝える", async () => {
    const { lambda } = fakeLambda({
      StatusCode: 200,
      FunctionError: "Unhandled",
      Payload: encode(RESULT),
    });
    await assert.rejects(requestSignedUrl(lambda, FUNCTION, REQUEST));
  });

  it("返った値が URL と期限の形でなければ失敗する", async () => {
    for (const payload of [
      encode(null),
      encode({ url: RESULT.url }),
      encode({ ...RESULT, url: 1 }),
      undefined,
      new TextEncoder().encode("not json"),
    ]) {
      const { lambda } = fakeLambda({ StatusCode: 200, Payload: payload });
      await assert.rejects(requestSignedUrl(lambda, FUNCTION, REQUEST));
    }
  });
});
