/** A2 · 纯工具函数:BigInt/Decimal/Date → API 视图类型;UTC 时间窗口 */

/** BigInt → number(API 契约里 id 一律 number) */
export const num = (v: bigint | number): number => Number(v);

/** Date → ISO 字符串(契约 date-time) */
export function iso(d: Date): string;
export function iso(d: Date | null | undefined): string | null;
export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** Prisma Decimal | null → number | null */
export const dec = (v: unknown): number | null => (v == null ? null : Number(v));

export const round1 = (x: number): number => Math.round(x * 10) / 10;
export const round2 = (x: number): number => Math.round(x * 100) / 100;
export const round4 = (x: number): number => Math.round(x * 10000) / 10000;

/** 当前月 'yyyy-MM'(UTC,与 ai_quotas.period 对齐) */
export function periodOf(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function utcMonthStart(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function utcDayStart(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function daysAgoUtc(days: number, from: Date = new Date()): Date {
  return new Date(utcDayStart(from).getTime() - days * 86400_000);
}

/** 'yyyy-MM-dd'(UTC) */
export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** user.profile JSON 安全取字段 */
export function profileField(profile: unknown, key: string): string {
  const p = profile as Record<string, unknown> | null;
  const v = p?.[key];
  return typeof v === 'string' ? v : '';
}
