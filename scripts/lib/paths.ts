import { join } from "node:path";
import { fileURLToPath } from "node:url";

// このファイルからの相対で決めるので、どのディレクトリで実行しても同じ場所を指す。
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const PRIVATE_KEY_FILE = "private.pem";
export const PUBLIC_KEY_FILE = "public.pem";

/** 鍵ファイルの置き場所。.keys/ は .gitignore で除外している。 */
export const KEYS_DIR = join(REPO_ROOT, ".keys");
export const PRIVATE_KEY_PATH = join(KEYS_DIR, PRIVATE_KEY_FILE);
export const PUBLIC_KEY_PATH = join(KEYS_DIR, PUBLIC_KEY_FILE);

/** 公開するページの一覧。手元のパスを含むので、.gitignore で除外している。 */
export const DEFAULT_CONFIG_PATH = join(REPO_ROOT, "html-share.config.json");
export const LOCK_DIR = join(REPO_ROOT, ".html-share", "sync.lock");
