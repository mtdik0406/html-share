import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { S3Client } from "@aws-sdk/client-s3";
import { DEFAULT_CONFIG_PATH, LOCK_DIR, REPO_ROOT, RETIRED_PATH } from "../core/paths.js";
import { runCli } from "./lib/cli.js";
import { parseConfig } from "./lib/config.js";
import { readStackOutputs } from "./lib/stack-outputs.js";
import { runSync } from "./lib/sync-run.js";

await runCli(async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "allow-mass-delete": { type: "boolean", default: false },
    },
  });
  // 余分な引数を黙って捨てない。`--` の後ろのオプションは位置引数になり、無視されてしまうため。
  if (positionals.length !== 0) {
    throw new Error("使い方: pnpm run sync [--config <path>] [--dry-run] [--allow-mass-delete]");
  }

  const configPath = resolve(values.config ?? DEFAULT_CONFIG_PATH);
  if (!existsSync(configPath)) {
    throw new Error(
      `設定ファイルがありません: ${configPath}\nhtml-share.config.example.json を写して作ってください`,
    );
  }
  const config = parseConfig(readFileSync(configPath, "utf8"), dirname(configPath), homedir(), [
    homedir(),
    REPO_ROOT,
  ]);

  const dryRun = values["dry-run"];
  const plan = await runSync(
    config,
    { dryRun, allowMassDelete: values["allow-mass-delete"] },
    {
      s3: new S3Client({}),
      bucketName: async () => (await readStackOutputs(new CloudFormationClient({})))("bucketName"),
      lockDir: LOCK_DIR,
      retiredPath: RETIRED_PATH,
      now: () => new Date(),
      log: (line) => console.log(line),
    },
  );
  console.log(
    dryRun
      ? "--dry-run なので、S3 は変えていません"
      : `完了: add ${plan.add.length}, update ${plan.update.length}, archive ${plan.remove.length}`,
  );
});
