import { parseArgs } from "node:util";
import { SSMClient } from "@aws-sdk/client-ssm";
import { SIGNING_KEY_GENERATION } from "../lib/names.js";
import { runCli } from "./lib/cli.js";
import { deleteSigningKeys, listSigningKeys, selectKeysToDelete } from "./lib/signing-key.js";

// 消した鍵は戻せない。--all は、スタックを片付けるときだけに使う。
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

  const ssm = new SSMClient({});
  const names = selectKeysToDelete(await listSigningKeys(ssm), SIGNING_KEY_GENERATION, values.all);
  if (names.length === 0) {
    console.log("消す鍵はありません");
    return;
  }
  for (const name of names) console.log(`delete ${name}`);
  if (values["dry-run"]) {
    console.log("--dry-run なので、消していません");
    return;
  }
  await deleteSigningKeys(ssm, names);
  console.log(`${names.length} 個の鍵を消しました`);
});
