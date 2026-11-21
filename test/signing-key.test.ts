import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DeleteParametersCommand,
  DescribeParametersCommand,
  GetParameterCommand,
  PutParameterCommand,
} from "@aws-sdk/client-ssm";
import { signingKeyParameterName } from "../lib/names.js";
import {
  deleteSigningKeys,
  listSigningKeys,
  loadSigningKey,
  type SsmSender,
  selectKeysToDelete,
  storeSigningKey,
} from "../scripts/lib/signing-key.js";
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

const gen = signingKeyParameterName;

describe("selectKeysToDelete", () => {
  it("今の世代より前の鍵だけを選ぶ", () => {
    assert.deepEqual(selectKeysToDelete([gen(1), gen(2), gen(3)], 3, false), [gen(1), gen(2)]);
  });

  it("今の世代の鍵と、先に置いた次の世代の鍵は選ばない", () => {
    assert.deepEqual(selectKeysToDelete([gen(2), gen(3)], 2, false), []);
  });

  it("all ならすべて選ぶ", () => {
    assert.deepEqual(selectKeysToDelete([gen(1), gen(2), gen(3)], 2, true), [
      gen(1),
      gen(2),
      gen(3),
    ]);
  });

  it("署名の鍵でない名前は、all でも選ばない", () => {
    assert.deepEqual(selectKeysToDelete(["/html-share/other", gen(1)], 2, true), [gen(1)]);
  });
});

describe("listSigningKeys", () => {
  it("名前の先頭で絞って読み、続きがあればすべて読む", async () => {
    const pages = [
      {
        Parameters: [{ Name: gen(1) }, { Name: "/html-share/signing-private-key-old" }],
        NextToken: "t",
      },
      { Parameters: [{ Name: gen(2) }, {}], NextToken: "u" },
      {},
    ];
    const { ssm, sent } = fakeSsm(() => pages.shift());
    assert.deepEqual(await listSigningKeys(ssm), [gen(1), gen(2)]);
    assert.equal(sent.length, 3);
    const [first, second] = sent;
    assert.ok(first instanceof DescribeParametersCommand);
    assert.deepEqual(first.input.ParameterFilters, [
      { Key: "Name", Option: "BeginsWith", Values: [gen(1)] },
    ]);
    assert.ok(second instanceof DescribeParametersCommand);
    assert.equal(second.input.NextToken, "t");
  });
});

describe("deleteSigningKeys", () => {
  it("1 回に 10 個ずつ消す", async () => {
    // 消せた回の応答には、InvalidParameters がないことがある。
    const { ssm, sent } = fakeSsm(() => ({}));
    const names = Array.from({ length: 11 }, (_, i) => gen(i + 1));
    await deleteSigningKeys(ssm, names);
    assert.deepEqual(
      sent.map((c) => (c as DeleteParametersCommand).input.Names),
      [names.slice(0, 10), names.slice(10)],
    );
    assert.ok(sent.every((c) => c instanceof DeleteParametersCommand));
  });

  it("消す名前がなければ、何も送らない", async () => {
    const { ssm, sent } = fakeSsm();
    await deleteSigningKeys(ssm, []);
    assert.equal(sent.length, 0);
  });

  it("消せなかった名前があれば失敗する", async () => {
    const { ssm } = fakeSsm(() => ({ InvalidParameters: [gen(2)] }));
    await assert.rejects(deleteSigningKeys(ssm, [gen(1), gen(2)]));
  });
});
