import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { type CfnSender, readStackOutputs } from "../../../cli/lib/stack-outputs.js";
import { OUTPUT_KEYS, STACK_NAME } from "../../../core/names.js";

function fakeCfn(response: object) {
  const sent: object[] = [];
  const cfn: CfnSender = {
    async send(command) {
      sent.push(command);
      return response;
    },
  };
  return { cfn, sent };
}

const ONLY_BUCKET = {
  Stacks: [{ Outputs: [{ OutputKey: OUTPUT_KEYS.bucketName, OutputValue: "bucket-1" }] }],
};

describe("readStackOutputs", () => {
  it("このスタックの出力を、名前で引ける", async () => {
    const { cfn, sent } = fakeCfn(ONLY_BUCKET);
    const output = await readStackOutputs(cfn);
    assert.equal(output("bucketName"), "bucket-1");
    const [command] = sent;
    assert.ok(command instanceof DescribeStacksCommand);
    assert.equal(command.input.StackName, STACK_NAME);
  });

  it("使わない出力がなくても、使う出力は引ける", async () => {
    const { cfn } = fakeCfn(ONLY_BUCKET);
    const output = await readStackOutputs(cfn);
    assert.equal(output("bucketName"), "bucket-1");
    assert.throws(() => output("signFunctionName"));
  });

  it("出力がないか空なら、引いたときに失敗する", async () => {
    for (const response of [
      {},
      { Stacks: [] },
      { Stacks: [{}] },
      { Stacks: [{ Outputs: [{ OutputKey: OUTPUT_KEYS.bucketName, OutputValue: "" }] }] },
    ]) {
      const output = await readStackOutputs(fakeCfn(response).cfn);
      assert.throws(() => output("bucketName"));
    }
  });
});
