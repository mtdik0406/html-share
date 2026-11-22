import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GetFunctionConfigurationCommand } from "@aws-sdk/client-lambda";
import {
  DeleteParametersCommand,
  DescribeParametersCommand,
  PutParameterCommand,
} from "@aws-sdk/client-ssm";
import {
  deleteSigningKeys,
  listSigningKeys,
  readDeployedKeyGeneration,
  runKeysDelete,
  selectKeysToDelete,
  storeSigningKey,
} from "../../../cli/lib/signing-key.js";
import { SIGN_FUNCTION_ENV, signingKeyParameterName } from "../../../core/names.js";
import { fakeSender } from "../../helpers/fake-sender.js";
import { generateTestKeyPair } from "../../helpers/keys.js";

const NAME = "/html-share/test-key";

const pair = generateTestKeyPair();

describe("storeSigningKey", () => {
  it("秘密鍵を SecureString として、既存の値を上書きせずに置く", async () => {
    const { client: ssm, sent } = fakeSender();
    await storeSigningKey(ssm, {
      parameterName: NAME,
      privateKeyPem: pair.privateKey,
      publicKeyPem: pair.publicKey,
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

  it("秘密鍵が公開鍵と対でなければ、送らずに失敗する", async () => {
    const { client: ssm, sent } = fakeSender();
    const other = generateTestKeyPair();
    await assert.rejects(
      storeSigningKey(ssm, {
        parameterName: NAME,
        privateKeyPem: other.privateKey,
        publicKeyPem: pair.publicKey,
      }),
    );
    assert.equal(sent.length, 0);
  });

  it("秘密鍵として読めない値は、送らずに失敗する", async () => {
    const { client: ssm, sent } = fakeSender();
    for (const privateKeyPem of ["", pair.publicKey]) {
      await assert.rejects(
        storeSigningKey(ssm, {
          parameterName: NAME,
          privateKeyPem,
          publicKeyPem: pair.publicKey,
        }),
      );
    }
    assert.equal(sent.length, 0);
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
    const { client: ssm, sent } = fakeSender(() => pages.shift());
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
    const { client: ssm, sent } = fakeSender(() => ({}));
    const names = Array.from({ length: 11 }, (_, i) => gen(i + 1));
    await deleteSigningKeys(ssm, names);
    assert.deepEqual(
      sent.map((c) => (c as DeleteParametersCommand).input.Names),
      [names.slice(0, 10), names.slice(10)],
    );
    assert.ok(sent.every((c) => c instanceof DeleteParametersCommand));
  });

  it("消す名前がなければ、何も送らない", async () => {
    const { client: ssm, sent } = fakeSender();
    await deleteSigningKeys(ssm, []);
    assert.equal(sent.length, 0);
  });

  it("消せなかった名前があれば失敗する", async () => {
    const { client: ssm } = fakeSender(() => ({ InvalidParameters: [gen(2)] }));
    await assert.rejects(deleteSigningKeys(ssm, [gen(1), gen(2)]));
  });
});

describe("runKeysDelete", () => {
  const listed = { Parameters: [{ Name: gen(1) }, { Name: gen(2) }, { Name: gen(3) }] };
  function setup(currentGeneration: number, deployed: number | undefined) {
    const { client: ssm, sent } = fakeSender((command) =>
      command instanceof DescribeParametersCommand ? listed : {},
    );
    const deletes = () => sent.filter((c) => c instanceof DeleteParametersCommand);
    const deps = {
      ssm,
      currentGeneration,
      deployedGeneration: async () => deployed,
      log: () => {},
    };
    return { deps, deletes };
  }

  it("デプロイ済みの世代が今の世代と同じなら、前の世代の鍵を消す", async () => {
    const { deps, deletes } = setup(2, 2);
    assert.deepEqual(await runKeysDelete(deps, { all: false, dryRun: false }), [gen(1)]);
    assert.deepEqual(
      deletes().map((c) => (c as DeleteParametersCommand).input.Names),
      [[gen(1)]],
    );
  });

  it("デプロイ済みの世代が今の世代と違えば、何も消さずに失敗する", async () => {
    for (const deployed of [1, 3, undefined]) {
      const { deps, deletes } = setup(2, deployed);
      await assert.rejects(runKeysDelete(deps, { all: false, dryRun: false }));
      assert.equal(deletes().length, 0);
    }
  });

  it("all なら、デプロイ済みの世代を見ずにすべて消す（スタックを片付けたあとに使う）", async () => {
    const { deps, deletes } = setup(2, undefined);
    assert.deepEqual(await runKeysDelete(deps, { all: true, dryRun: false }), [
      gen(1),
      gen(2),
      gen(3),
    ]);
    assert.equal(deletes().length, 1);
  });

  it("dry-run なら、選ぶだけで消さない", async () => {
    const { deps, deletes } = setup(2, 2);
    assert.deepEqual(await runKeysDelete(deps, { all: true, dryRun: true }), [
      gen(1),
      gen(2),
      gen(3),
    ]);
    assert.equal(deletes().length, 0);
  });

  it("今の世代が 1 以上の整数でなければ、何も消さずに失敗する", async () => {
    for (const current of [0, 1.5]) {
      const { deps, deletes } = setup(current, current);
      await assert.rejects(runKeysDelete(deps, { all: false, dryRun: false }));
      assert.equal(deletes().length, 0);
    }
  });
});

describe("readDeployedKeyGeneration", () => {
  const lambdaReturning = (response: object) => {
    const sent: object[] = [];
    return {
      sent,
      lambda: {
        async send(command: object) {
          sent.push(command);
          return response;
        },
      },
    };
  };

  it("署名の Lambda が読むパラメータの名前から世代を読む", async () => {
    const { lambda, sent } = lambdaReturning({
      Environment: { Variables: { [SIGN_FUNCTION_ENV.parameterName]: gen(3) } },
    });
    assert.equal(await readDeployedKeyGeneration(lambda, "fn"), 3);
    const [command] = sent;
    assert.ok(command instanceof GetFunctionConfigurationCommand);
    assert.equal(command.input.FunctionName, "fn");
  });

  it("読めなければ undefined", async () => {
    for (const response of [
      {},
      { Environment: {} },
      { Environment: { Variables: { [SIGN_FUNCTION_ENV.parameterName]: "/other" } } },
    ]) {
      assert.equal(
        await readDeployedKeyGeneration(lambdaReturning(response).lambda, "fn"),
        undefined,
      );
    }
  });
});
