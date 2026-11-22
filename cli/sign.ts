import { parseArgs } from "node:util";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { parseLifetimeMs } from "../core/lifetime.js";
import { assertSlug } from "../core/page.js";
import { runCli } from "./lib/cli.js";
import { requestSignedUrl } from "./lib/remote-sign.js";
import { readStackOutputs } from "./lib/stack-outputs.js";

// 手元の秘密鍵は読まない。署名は SSM の鍵を持つ Lambda が行う（ADR 9）。
await runCli(async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      days: { type: "string" },
      minutes: { type: "string" },
    },
  });

  // 余分な引数を黙って捨てない。`--` の後ろのオプションは位置引数になり、無視されてしまうため。
  if (positionals.length !== 1) {
    throw new Error("使い方: pnpm run sign <slug> [--days N | --minutes N]");
  }
  const [slug] = positionals;
  assertSlug(slug);
  const lifetimeMs = parseLifetimeMs(values);

  const output = await readStackOutputs(new CloudFormationClient({}));
  const { url, expiresAt } = await requestSignedUrl(
    new LambdaClient({}),
    output("signFunctionName"),
    {
      slug,
      lifetimeMs,
    },
  );

  console.log(`expires: ${expiresAt}`);
  console.log(url);
});
