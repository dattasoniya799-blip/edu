/**
 * 学生学习时段(org.settings.studentHours)解析与判定(fix-core A3)。
 *
 * 语义约定:
 * - 仅支持同日窗口 start < end(如 06:00-22:30);跨零点窗口不支持;
 * - 配置缺失、形状非法、时间格式非法(如 25:99)或 start >= end → 视为「不限制」
 *   (向后兼容:该设置历史上是纯摆设,存量脏数据不应把学生锁在门外);
 * - 窗口边界按分钟粒度、双端闭区间:06:00-22:30 表示 06:00:00 至 22:30:59 均可登录。
 */

export interface StudentHoursWindow {
  start: string;
  end: string;
}

/** HH:MM,小时 00-23、分钟 00-59(与 admin StudentHoursDto 校验同一口径) */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const toMinutes = (hhmm: string): number =>
  Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

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

/** now(默认当前时刻,服务器本地时区)是否在学习时段内;无有效配置恒为 true */
export function isWithinStudentHours(settings: unknown, now: Date = new Date()): boolean {
  const win = parseStudentHours(settings);
  if (!win) return true;
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= toMinutes(win.start) && cur <= toMinutes(win.end);
}
