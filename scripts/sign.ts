import { parseArgs } from "node:util";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { runCli } from "./lib/cli.js";
import { parseLifetimeMs } from "./lib/lifetime.js";
import { assertSlug } from "./lib/page.js";
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

  const { signFunctionName } = await readStackOutputs();
  const { url, expiresAt } = await requestSignedUrl(new LambdaClient({}), signFunctionName, {
    slug,
    lifetimeMs,
  });

  console.log(`expires: ${expiresAt}`);
  console.log(url);
});
