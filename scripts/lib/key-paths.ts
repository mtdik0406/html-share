import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PRIVATE_KEY_FILE = "private.pem";
export const PUBLIC_KEY_FILE = "public.pem";

/**
 * 鍵ファイルの置き場所。.keys/ は .gitignore で除外している。
 * このファイルからの相対で決めるので、どのディレクトリで実行しても同じ場所を指す。
 */
export const KEYS_DIR = fileURLToPath(new URL("../../.keys/", import.meta.url));
export const PRIVATE_KEY_PATH = join(KEYS_DIR, PRIVATE_KEY_FILE);
export const PUBLIC_KEY_PATH = join(KEYS_DIR, PUBLIC_KEY_FILE);
