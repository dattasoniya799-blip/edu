/**
 * 学生学习时段(org.settings.studentHours)解析与判定(fix-core A3)。
 *
 * 语义约定:
 * - 仅支持同日窗口 start < end(如 06:00-22:30);跨零点窗口不支持;
 * - 配置缺失、形状非法、时间格式非法(如 25:99)或 start >= end → 视为「不限制」
 *   (向后兼容:该设置历史上是纯摆设,存量脏数据不应把学生锁在门外);
 * - 窗口边界按分钟粒度、双端闭区间:06:00-22:30 表示 06:00:00 至 22:30:59 均可登录;
 * - **时区**:管理员填的是机构所在地的钟表时间,判定必须按机构时区取「现在几点」,
 *   而不是服务器进程时区(走查 D-2:生产镜像 TZ=UTC 会把 06:00-22:30 错位 8 小时)。
 *   时区取 env `ORG_TIMEZONE`,缺省 Asia/Shanghai;非法值回退 Asia/Shanghai。
 */

export interface StudentHoursWindow {
  start: string;
  end: string;
}

/** HH:MM,小时 00-23、分钟 00-59(与 admin StudentHoursDto 校验同一口径) */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const toMinutes = (hhmm: string): number =>
  Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export const DEFAULT_ORG_TIMEZONE = 'Asia/Shanghai';

/** 机构时区(env ORG_TIMEZONE,非法回退默认);单机构 MVP 全局一个值,多机构时改为 org.settings */
export function orgTimeZone(): string {
  const tz = process.env.ORG_TIMEZONE?.trim() || DEFAULT_ORG_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_ORG_TIMEZONE;
  }
}

/** now 在指定时区的「当日分钟数」(0–1439),与进程时区无关 */
export function minutesOfDayIn(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

/** 从 org.settings 解析学习时段;非法/缺失返回 null(= 不限制) */
export function parseStudentHours(settings: unknown): StudentHoursWindow | null {
  if (settings == null || typeof settings !== 'object') return null;
  const sh = (settings as { studentHours?: unknown }).studentHours;
  if (sh == null || typeof sh !== 'object') return null;
  const { start, end } = sh as { start?: unknown; end?: unknown };
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  if (!HHMM_RE.test(start) || !HHMM_RE.test(end)) return null;
  if (toMinutes(start) >= toMinutes(end)) return null; // 仅支持 start<end
  return { start, end };
}

/** now(默认当前时刻)按机构时区是否在学习时段内;无有效配置恒为 true */
export function isWithinStudentHours(
  settings: unknown,
  now: Date = new Date(),
  timeZone: string = orgTimeZone(),
): boolean {
  const win = parseStudentHours(settings);
  if (!win) return true;
  const cur = minutesOfDayIn(now, timeZone);
  return cur >= toMinutes(win.start) && cur <= toMinutes(win.end);
}
