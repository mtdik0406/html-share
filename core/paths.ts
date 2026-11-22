import { join } from "node:path";
import { fileURLToPath } from "node:url";

// このファイルからの相対で決めるので、どのディレクトリで実行しても同じ場所を指す。
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const PRIVATE_KEY_FILE = "private.pem";
export const PUBLIC_KEY_FILE = "public.pem";

/** .gitignore で除外している。 */
export const KEYS_DIR = join(REPO_ROOT, ".keys");
export const PRIVATE_KEY_PATH = join(KEYS_DIR, PRIVATE_KEY_FILE);
export const PUBLIC_KEY_PATH = join(KEYS_DIR, PUBLIC_KEY_FILE);

/** 手元のパスを含むので、.gitignore で除外している。 */
export const DEFAULT_CONFIG_PATH = join(REPO_ROOT, "html-share.config.json");
const STATE_DIR = join(REPO_ROOT, ".html-share");
export const LOCK_DIR = join(STATE_DIR, "sync.lock");
/** 取り下げた slug と時刻。消すと、取り下げた slug の再利用を止められなくなる。 */
export const RETIRED_PATH = join(STATE_DIR, "retired.json");
