import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { SSMClient } from "@aws-sdk/client-ssm";
import { SIGNING_KEY_PARAMETER_NAME } from "../lib/names.js";
import { runCli } from "./lib/cli.js";
import { PRIVATE_KEY_PATH, PUBLIC_KEY_PATH } from "./lib/paths.js";
import { storeSigningKey } from "./lib/signing-key.js";

// 鍵の中身は表示しない。読んだ値は SDK にだけ渡す。
await runCli(async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { overwrite: { type: "boolean", default: false } },
  });
  if (positionals.length !== 0) {
    throw new Error("使い方: pnpm run keys:store [--overwrite]");
  }

  await storeSigningKey(new SSMClient({}), {
    parameterName: SIGNING_KEY_PARAMETER_NAME,
    privateKeyPem: await readFile(PRIVATE_KEY_PATH, "utf8"),
    publicKeyPem: await readFile(PUBLIC_KEY_PATH, "utf8"),
    overwrite: values.overwrite,
  });
  console.log(`秘密鍵を SSM の ${SIGNING_KEY_PARAMETER_NAME} に置きました`);
});
