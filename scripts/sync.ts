import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { S3Client } from "@aws-sdk/client-s3";
import { runCli } from "./lib/cli.js";
import { parseConfig } from "./lib/config.js";
import { embedPage } from "./lib/embed.js";
import { acquireLock } from "./lib/lock.js";
import { PAGES_PREFIX, pageKey } from "./lib/page.js";
import { DEFAULT_CONFIG_PATH, LOCK_DIR } from "./lib/paths.js";
import { applyPlan, listRemote } from "./lib/s3-sync.js";
import { readStackOutputs } from "./lib/stack-outputs.js";
import { assertSafeToApply, type LocalObject, planSync } from "./lib/sync-plan.js";

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
  const config = parseConfig(readFileSync(configPath, "utf8"), dirname(configPath), homedir());

  // 一覧を読んでから消すまでの間に、別の同期が割り込まないようにする。
  const release = acquireLock(LOCK_DIR);
  try {
    // AWS に問い合わせる前に、手元の入力の誤りを見つける。
    const bodies = new Map<string, Buffer>();
    const local: LocalObject[] = [];
    for (const page of config.pages) {
      const { html, warnings } = embedPage(page.source, config.roots);
      for (const warning of warnings) console.warn(`warning: ${page.slug}: ${warning}`);
      const key = pageKey(page.slug);
      bodies.set(key, html);
      local.push({ key, md5: createHash("md5").update(html).digest("hex") });
    }

    const { bucketName } = await readStackOutputs();
    const s3 = new S3Client({});
    const remote = await listRemote(s3, bucketName, PAGES_PREFIX);
    const plan = planSync(local, remote);

    for (const key of plan.add) console.log(`add       ${key}`);
    for (const key of plan.update) console.log(`update    ${key}`);
    for (const key of plan.remove) console.log(`delete    ${key}`);
    console.log(`unchanged ${plan.unchanged.length} ページ`);

    assertSafeToApply(plan, remote.length, { allowMassDelete: values["allow-mass-delete"] });
    if (values["dry-run"]) {
      console.log("--dry-run なので、S3 は変えていません");
      return;
    }

    await applyPlan(s3, bucketName, plan, bodies);

    console.log(
      `完了: add ${plan.add.length}, update ${plan.update.length}, delete ${plan.remove.length}`,
    );
  } finally {
    release();
  }
});
