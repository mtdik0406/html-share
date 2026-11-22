import { parseArgs } from "node:util";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { SSMClient } from "@aws-sdk/client-ssm";
import { SIGNING_KEY_GENERATION } from "../core/names.js";
import { readDeployedKeyGeneration, runKeysDelete } from "../core/signing-key.js";
import { runCli } from "./lib/cli.js";
import { readStackOutputs } from "./lib/stack-outputs.js";

// 消した鍵は戻せない。--all は、スタックを片付けたあとだけに使う。
await runCli(async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      all: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (positionals.length !== 0) {
    throw new Error("使い方: pnpm run keys:delete [--all] [--dry-run]");
  }

  const dryRun = values["dry-run"];
  const names = await runKeysDelete(
    {
      ssm: new SSMClient({}),
      currentGeneration: SIGNING_KEY_GENERATION,
      deployedGeneration: async () => {
        const output = await readStackOutputs(new CloudFormationClient({}));
        return readDeployedKeyGeneration(new LambdaClient({}), output("signFunctionName"));
      },
      log: (line) => console.log(line),
    },
    { all: values.all, dryRun },
  );
  if (names.length === 0) console.log("消す鍵はありません");
  else if (dryRun) console.log("--dry-run なので、消していません");
  else console.log(`${names.length} 個の鍵を消しました`);
});
