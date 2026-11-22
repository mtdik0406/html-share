export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

export const DEFAULT_DAYS = 7;
export const MAX_DAYS = 30;
/** 手元とサーバーの時計のずれや、URL を開くまでの操作の時間を見込んだ最小単位。 */
const MIN_LIFETIME_MS = MINUTE_MS;

export function validateLifetimeMs(ms: number): void {
  if (!Number.isFinite(ms) || ms < MIN_LIFETIME_MS) {
    throw new Error("期限は 1 分以上にしてください");
  }
  if (ms > MAX_DAYS * DAY_MS) {
    throw new Error(`期限は ${MAX_DAYS} 日以内にしてください`);
  }
}
