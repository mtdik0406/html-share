import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { OUTPUT_KEYS, STACK_NAME } from "../../lib/names.js";

export type StackOutputs = Record<keyof typeof OUTPUT_KEYS, string>;

/** 値をファイルに書き写さず毎回読むのは、スタックを作り直したときに古い値が残ってずれるのを防ぐため。 */
export async function readStackOutputs(): Promise<StackOutputs> {
  const cfn = new CloudFormationClient({});
  const res = await cfn.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
  const outputs = res.Stacks?.[0]?.Outputs ?? [];
  const get = (key: string): string => {
    const value = outputs.find((o) => o.OutputKey === key)?.OutputValue;
    if (!value) throw new Error(`スタック ${STACK_NAME} に出力 ${key} がありません`);
    return value;
  };
  return {
    bucketName: get(OUTPUT_KEYS.bucketName),
    distributionDomainName: get(OUTPUT_KEYS.distributionDomainName),
    publicKeyId: get(OUTPUT_KEYS.publicKeyId),
  };
}
