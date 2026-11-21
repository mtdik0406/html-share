import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { SSMClient } from "@aws-sdk/client-ssm";
import { SIGNING_KEY_GENERATION, signingKeyParameterName } from "../lib/names.js";
import { runCli } from "./lib/cli.js";
import { PRIVATE_KEY_PATH, PUBLIC_KEY_PATH } from "./lib/paths.js";
import { storeSigningKey } from "./lib/signing-key.js";

const parameterName = signingKeyParameterName(SIGNING_KEY_GENERATION);

// 鍵の中身は表示しない。読んだ値は SDK にだけ渡す。
await runCli(async () => {
  const { positionals } = parseArgs({ allowPositionals: true });
  if (positionals.length !== 0) {
    throw new Error("使い方: pnpm run keys:store");
  }

  await storeSigningKey(new SSMClient({}), {
    parameterName,
    privateKeyPem: await readFile(PRIVATE_KEY_PATH, "utf8"),
    publicKeyPem: await readFile(PUBLIC_KEY_PATH, "utf8"),
  });
  console.log(`秘密鍵を SSM の ${parameterName} に置きました`);
});
