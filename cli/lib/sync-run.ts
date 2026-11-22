import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PAGES_PREFIX, pageKey, slugOfKey } from "../../core/page.js";
import { applyPlan, listRemote, type S3Sender } from "../../core/s3-sync.js";
import {
  assertSafeToApply,
  type LocalObject,
  planSync,
  type SyncPlan,
} from "../../core/sync-plan.js";
import type { SyncConfig } from "./config.js";
import { embedPage } from "./embed.js";
import { acquireLock } from "./lock.js";
import { assertNoRecentReuse, parseRetired, type RetiredSlugs, recordRetired } from "./retired.js";

export interface SyncOptions {
  dryRun: boolean;
  allowMassDelete: boolean;
}

export interface SyncDeps {
  s3: S3Sender;
  /** 手元の誤りを見つけ終わるまで AWS に問い合わせないよう、呼ばれたときに取りに行く。 */
  bucketName: () => Promise<string>;
  lockDir: string;
  retiredPath: string;
  now: () => Date;
  log: (line: string) => void;
}

export async function runSync(
  config: SyncConfig,
  options: SyncOptions,
  deps: SyncDeps,
): Promise<SyncPlan> {
  // 一覧を読んでから消すまでの間に、別の同期が割り込まないようにする。
  const release = acquireLock(deps.lockDir);
  try {
    const retired = readRetired(deps.retiredPath);
    assertNoRecentReuse(
      config.pages.map((p) => p.slug),
      retired,
      deps.now(),
    );
    const { local, bodies } = embedPages(config, deps.log);

    const bucket = await deps.bucketName();
    const remote = await listRemote(deps.s3, bucket, PAGES_PREFIX);
    const plan = planSync(local, remote);

    for (const key of plan.add) deps.log(`add       ${key}`);
    for (const key of plan.update) deps.log(`update    ${key}`);
    for (const key of plan.remove) deps.log(`delete    ${key}`);
    deps.log(`unchanged ${plan.unchanged.length} ページ`);

    assertSafeToApply(plan, remote.length, { allowMassDelete: options.allowMassDelete });
    if (options.dryRun) return plan;

    await applyPlan(deps.s3, bucket, plan, bodies);
    const removedSlugs = plan.remove.flatMap((key) => slugOfKey(key) ?? []);
    writeRetired(deps.retiredPath, recordRetired(retired, removedSlugs, deps.now()));
    return plan;
  } finally {
    release();
  }
}

function embedPages(
  config: SyncConfig,
  log: (line: string) => void,
): { local: LocalObject[]; bodies: Map<string, Buffer> } {
  const local: LocalObject[] = [];
  const bodies = new Map<string, Buffer>();
  for (const page of config.pages) {
    const { html, assets, warnings } = embedPage(page.source, config.roots);
    log(`embed     ${page.slug}: ${page.source}`);
    for (const asset of assets) log(`          + ${asset}`);
    for (const warning of warnings) log(`warning   ${page.slug}: ${warning}`);
    const key = pageKey(page.slug);
    bodies.set(key, html);
    local.push({ key, md5: createHash("md5").update(html).digest("hex") });
  }
  return { local, bodies };
}

function readRetired(path: string): RetiredSlugs {
  return existsSync(path) ? parseRetired(readFileSync(path, "utf8")) : {};
}

function writeRetired(path: string, retired: RetiredSlugs): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(retired, null, 2)}\n`);
}
