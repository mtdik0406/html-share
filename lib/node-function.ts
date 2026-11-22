import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

// aws-cdk-lib に定数がまだないので、名前で指定する（ADR 9）。
const NODEJS_26 = new lambda.Runtime("nodejs26.x", lambda.RuntimeFamily.NODEJS);

export interface NodeFunctionProps {
  description: string;
  /** バンドルの入口。import.meta.url からの URL で渡す。 */
  entry: string;
  environment: Record<string, string>;
}

/** このスタックの Lambda は、どれも同じランタイム・バンドル・ログの残し方にする。 */
export function nodeFunction(scope: Construct, id: string, props: NodeFunctionProps) {
  return new nodejs.NodejsFunction(scope, id, {
    description: props.description,
    entry: props.entry,
    runtime: NODEJS_26,
    architecture: lambda.Architecture.ARM_64,
    memorySize: 256,
    timeout: Duration.seconds(10),
    environment: props.environment,
    bundling: {
      format: nodejs.OutputFormat.ESM,
      // ランタイムに入っている SDK を使わず、手元と同じ版をバンドルに含める（ADR 9）。
      // Stryker disable next-line ArrayDeclaration: 存在しない名前を外に出しても、バンドルは同じ
      externalModules: [],
      // ESM のバンドルの中で、CommonJS の依存が require を使えるようにする。
      banner:
        "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    },
    logGroup: new logs.LogGroup(scope, `${id}Logs`, {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    }),
  });
}

/** SSM のパラメータの ARN。Lambda のロールに、使うパラメータだけを読ませるために使う。 */
export function parameterArn(scope: Construct, name: string): string {
  return Stack.of(scope).formatArn({
    service: "ssm",
    resource: "parameter",
    // ARN では、名前の先頭の / を resource の区切りと兼ねる。
    // Stryker disable next-line Regex: g のない replace は最初の 1 つだけを置き換え、名前は / で始まるので、^ の有無で結果は同じ
    resourceName: name.replace(/^\//, ""),
  });
}
