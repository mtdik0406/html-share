import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GetParameterCommand, PutParameterCommand } from "@aws-sdk/client-ssm";
import { loadSigningKey, type SsmSender, storeSigningKey } from "../scripts/lib/signing-key.js";
import { generateTestKeyPair } from "./helpers/keys.js";

const NAME = "/html-share/test-key";

function fakeSsm(respond: (command: object) => unknown = () => ({})) {
  const sent: object[] = [];
  const ssm: SsmSender = {
    async send(command) {
      sent.push(command);
      return respond(command);
    },
  };
  return { ssm, sent };
}

const pair = generateTestKeyPair();

describe("storeSigningKey", () => {
  it("秘密鍵を SecureString として、既存の値を上書きせずに置く", async () => {
    const { ssm, sent } = fakeSsm();
    await storeSigningKey(ssm, {
      parameterName: NAME,
      privateKeyPem: pair.privateKey,
      publicKeyPem: pair.publicKey,
      overwrite: false,
    });
    assert.equal(sent.length, 1);
    const [command] = sent;
    assert.ok(command instanceof PutParameterCommand);
    assert.deepEqual(command.input, {
      Name: NAME,
      Value: pair.privateKey,
      Type: "SecureString",
      Tier: "Standard",
      Overwrite: false,
    });
  });

  it("上書きを指定したときだけ、既存の値を上書きする", async () => {
    const { ssm, sent } = fakeSsm();
    await storeSigningKey(ssm, {
      parameterName: NAME,
      privateKeyPem: pair.privateKey,
      publicKeyPem: pair.publicKey,
      overwrite: true,
    });
    const [command] = sent;
    assert.ok(command instanceof PutParameterCommand);
    assert.equal(command.input.Overwrite, true);
  });

  it("秘密鍵が公開鍵と対でなければ、送らずに失敗する", async () => {
    const { ssm, sent } = fakeSsm();
    const other = generateTestKeyPair();
    await assert.rejects(
      storeSigningKey(ssm, {
        parameterName: NAME,
        privateKeyPem: other.privateKey,
        publicKeyPem: pair.publicKey,
        overwrite: false,
      }),
    );
    assert.equal(sent.length, 0);
  });

  it("秘密鍵として読めない値は、送らずに失敗する", async () => {
    const { ssm, sent } = fakeSsm();
    for (const privateKeyPem of ["", pair.publicKey]) {
      await assert.rejects(
        storeSigningKey(ssm, {
          parameterName: NAME,
          privateKeyPem,
          publicKeyPem: pair.publicKey,
          overwrite: false,
        }),
      );
    }
    assert.equal(sent.length, 0);
  });
});

describe("loadSigningKey", () => {
  it("復号を指定して読み、値を返す", async () => {
    const { ssm, sent } = fakeSsm(() => ({ Parameter: { Value: pair.privateKey } }));
    assert.equal(await loadSigningKey(ssm, NAME), pair.privateKey);
    const [command] = sent;
    assert.ok(command instanceof GetParameterCommand);
    assert.deepEqual(command.input, { Name: NAME, WithDecryption: true });
  });

  it("値がなければ失敗する", async () => {
    for (const response of [{}, { Parameter: {} }, { Parameter: { Value: "" } }]) {
      const { ssm } = fakeSsm(() => response);
      await assert.rejects(loadSigningKey(ssm, NAME));
    }
  });
});
