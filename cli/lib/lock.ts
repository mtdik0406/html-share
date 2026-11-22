import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 同期を 1 プロセスに絞る。2 つが重なると、片方が置いたページを、もう片方が古い一覧のまま消しうるため。
 * mkdir はディレクトリがすでにあれば失敗するので、確認と作成を 1 回の操作で行える。
 * 守れるのは同じマシンの中だけ。別のマシンからの同期とは排他にならない。
 */
export function acquireLock(lockDir: string): () => void {
  mkdirSync(dirname(lockDir), { recursive: true });
  if (!tryCreate(lockDir)) {
    const owner = readOwner(lockDir);
    // PID が読めないのは、相手が mkdir と PID の書き込みの間にいるときもある。古いロックとはみなさない。
    if (owner === undefined) {
      throw new Error(
        `別の同期が実行中か、ロックが壊れています。実行中の同期がなければ ${lockDir} を消してください`,
      );
    }
    if (isAlive(owner)) {
      // PID は再利用されるので、落ちたロックの PID が無関係のプロセスに当たることもある。消し方も伝える。
      throw new Error(
        `別の同期が実行中です（PID ${owner}）。終わるのを待つか、実行中でなければ ${lockDir} を消してください`,
      );
    }
    takeOverStaleLock(lockDir, owner);
  }
  return () => rmSync(lockDir, { recursive: true, force: true });
}

/**
 * 持ち主が落ちて残ったロックを取り直す。取り直し自体も別のロックで 1 プロセスに絞る。
 * 絞らないと、2 つのプロセスが同時に古いロックを見つけたとき、遅いほうが速いほうの新しいロックを消して、
 * 両方がロックを持ってしまう。
 */
function takeOverStaleLock(lockDir: string, staleOwner: number): void {
  const takeoverDir = `${lockDir}.takeover`;
  if (!tryCreate(takeoverDir)) {
    throw new Error(
      `別の同期がロックを取り直しています。実行中の同期がなければ ${takeoverDir} を消してください`,
    );
  }
  try {
    // 取り直しの権利を得るまでの間に、ほかのプロセスが先に取り直しているかもしれない。
    if (readOwner(lockDir) !== staleOwner)
      throw new Error("別の同期が実行中です。終わるのを待ってください");
    rmSync(lockDir, { recursive: true, force: true });
    if (!tryCreate(lockDir)) throw new Error("別の同期が実行中です。終わるのを待ってください");
  } finally {
    rmSync(takeoverDir, { recursive: true, force: true });
  }
}

function tryCreate(lockDir: string): boolean {
  try {
    mkdirSync(lockDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
  writeFileSync(join(lockDir, "pid"), String(process.pid));
  return true;
}

function readOwner(lockDir: string): number | undefined {
  try {
    const pid = Number(readFileSync(join(lockDir, "pid"), "utf8"));
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM はプロセスが存在するが、シグナルを送る権限がないだけ。
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
