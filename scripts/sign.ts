import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runCli } from "./lib/cli.js";
import { PRIVATE_KEY_PATH } from "./lib/key-paths.js";
import { parseLifetimeMs } from "./lib/lifetime.js";
import { assertSlug } from "./lib/page.js";
import { signPageUrl } from "./lib/signed-url.js";
import { readStackOutputs } from "./lib/stack-outputs.js";

await runCli(async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      days: { type: "string" },
      minutes: { type: "string" },
    },
  });

  const [slug] = positionals;
  assertSlug(slug);
  const lifetimeMs = parseLifetimeMs(values);

  const { distributionDomainName, publicKeyId } = await readStackOutputs();
  const expiresAt = new Date(Date.now() + lifetimeMs);

  const signedUrl = signPageUrl({
    distributionDomainName,
    slug,
    keyPairId: publicKeyId,
    privateKey: await readFile(PRIVATE_KEY_PATH),
    expiresAt,
  });

  console.log(`expires: ${expiresAt.toISOString()}`);
  console.log(signedUrl);
});
