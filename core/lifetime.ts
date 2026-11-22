const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

export const DEFAULT_DAYS = 7;
export const MAX_DAYS = 30;
/** 手元とサーバーの時計のずれや、URL を開くまでの操作の時間を見込んだ最小単位。 */
const MIN_LIFETIME_MS = MINUTE_MS;

export interface LifetimeOptions {
  days?: string | undefined;
  minutes?: string | undefined;
}

export function parseLifetimeMs({ days, minutes }: LifetimeOptions): number {
  if (days !== undefined && minutes !== undefined) {
    throw new Error("--days と --minutes は同時に指定できません");
  }

  // 真偽値ではなく undefined で判定する。`--minutes ""` を未指定とみなして既定の 7 日に倒さないため。
  // Stryker disable StringLiteral: 表示の文言
  const ms =
    minutes !== undefined
      ? toPositiveNumber("--minutes", minutes) * MINUTE_MS
      : days !== undefined
        ? toPositiveNumber("--days", days) * DAY_MS
        : DEFAULT_DAYS * DAY_MS;
  // Stryker restore StringLiteral

  validateLifetimeMs(ms);
  return ms;
}

export function validateLifetimeMs(ms: number): void {
  if (!Number.isFinite(ms) || ms < MIN_LIFETIME_MS) {
    throw new Error("期限は 1 分以上にしてください");
  }
  if (ms > MAX_DAYS * DAY_MS) {
    throw new Error(`期限は ${MAX_DAYS} 日以内にしてください`);
  }
}

function toPositiveNumber(flag: string, raw: string): number {
  // Number("") と Number(" ") は 0 になるので、空の値もここで弾かれる。
  const value = Number(raw);
  // Stryker disable all: 0 以下と数でない値は validateLifetimeMs も拒む。ここは、どの引数が誤りかを文言で示すため
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} には正の数を指定してください: "${raw}"`);
  }
  // Stryker restore all
  return value;
}
