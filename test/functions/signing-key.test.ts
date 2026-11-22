import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GetParameterCommand } from "@aws-sdk/client-ssm";
import { loadSigningKey } from "../../functions/signing-key.js";
import { fakeSender } from "../helpers/fake-sender.js";
import { generateTestKeyPair } from "../helpers/keys.js";

const NAME = "/html-share/test-key";

const pair = generateTestKeyPair();

describe("loadSigningKey", () => {
  it("復号を指定して読み、値を返す", async () => {
    const { client: ssm, sent } = fakeSender(() => ({ Parameter: { Value: pair.privateKey } }));
    assert.equal(await loadSigningKey(ssm, NAME), pair.privateKey);
    const [command] = sent;
    assert.ok(command instanceof GetParameterCommand);
    assert.deepEqual(command.input, { Name: NAME, WithDecryption: true });
  });

  it("値がなければ失敗する", async () => {
    for (const response of [{}, { Parameter: {} }, { Parameter: { Value: "" } }]) {
      const { client: ssm } = fakeSender(() => response);
      await assert.rejects(loadSigningKey(ssm, NAME));
    }
  });
});
