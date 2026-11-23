const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 2026-02-30 のように、形は合っていても実在しない日付も拒む。 */
export function assertRetainUntil(value: unknown, label: string): asserts value is string {
  const match = typeof value === "string" ? DATE_PATTERN.exec(value) : null;
  const [, y, m, d] = match ?? [];
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (match === null || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} は実在する日付を YYYY-MM-DD で書いてください: ${String(value)}`);
  }
}

/** retainUntil の日の終わりまでは公開する。日付は sync を実行する手元の時刻帯で数える（ADR 20）。 */
export function isExpired(retainUntil: string | undefined, now: Date): boolean {
  return retainUntil !== undefined && localDate(now) > retainUntil;
}

function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
