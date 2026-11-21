import {
  DescribeStacksCommand,
  type DescribeStacksCommandOutput,
} from "@aws-sdk/client-cloudformation";
import { OUTPUT_KEYS, STACK_NAME } from "../../lib/names.js";

export type OutputName = keyof typeof OUTPUT_KEYS;

/** CloudFormationClient の send だけを使う。テストで偽物に差し替えるため。 */
export interface CfnSender {
  send(command: object): Promise<unknown>;
}

/**
 * 値をファイルに書き写さず毎回読むのは、スタックを作り直したときに古い値が残ってずれるのを防ぐため。
 * 出力は、引いたときに確かめる。スタックに出力を足したとき、deploy するまで使わないスクリプトまで止めないため。
 */
export async function readStackOutputs(cfn: CfnSender): Promise<(name: OutputName) => string> {
  const res = (await cfn.send(
    new DescribeStacksCommand({ StackName: STACK_NAME }),
  )) as DescribeStacksCommandOutput;
  // Stryker disable next-line OptionalChaining: Stacks がなくても TypeError で失敗するので、振る舞いは同じ
  const outputs = res.Stacks?.[0]?.Outputs ?? [];
  return (name) => {
    const key = OUTPUT_KEYS[name];
    const value = outputs.find((o) => o.OutputKey === key)?.OutputValue;
    if (!value) throw new Error(`スタック ${STACK_NAME} に出力 ${key} がありません`);
    return value;
  };
}
