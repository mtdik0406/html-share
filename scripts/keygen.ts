import { runCli } from "./lib/cli.js";
import { KEYS_DIR } from "./lib/key-paths.js";
import { writeKeyPair } from "./lib/keygen.js";

await runCli(() => {
  writeKeyPair(KEYS_DIR);
  console.log("鍵ペアを作りました: .keys/private.pem（秘密鍵・git の対象外）, .keys/public.pem");
});
