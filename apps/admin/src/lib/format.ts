/** 展示用数据变换(纯函数,vitest 覆盖) */

/** 秒 → 「x h y min」;0/负数 → 「—」(原型口径:6 h 42 min) */
export function formatDurationHM(sec: number): string {
  if (!sec || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** token 数 → 万(最多 1 位小数,千分位) */
export function formatWan(n: number): string {
  return (n / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
}

/** 金额 → 「¥1,842」 */
export function formatMoney(n: number): string {
  return `¥${n.toLocaleString('zh-CN')}`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/** ISO → 「6 月 13 日(周六)」 */
export function formatDateCn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日(${WEEKDAYS[d.getDay()]})`;
}

/** 「YYYY-MM-DD」→ 图表 X 轴短标签「6.13」 */
export function formatDayShort(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  if (!m || !d) return dateStr;
  return `${Number(m)}.${Number(d)}`;
}

/** ISO → 「2026-03-02」 */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 按小时取问候语(原型:早上好,王校长) */
export function greeting(hour: number): string {
  if (hour < 5) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}
