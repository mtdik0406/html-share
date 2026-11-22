import { DAY_MS, DEFAULT_DAYS, MINUTE_MS, validateLifetimeMs } from "../../core/lifetime.js";

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
