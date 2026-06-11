/** B4 共用日期文案(中文,本地时区) */

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

export function fmtDate(iso: string | null): string {
  if (!iso) return '待排期';
  const d = new Date(iso);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日(周${WEEK[d.getDay()]})`;
}

export function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDateTime(iso: string | null): string {
  return iso ? `${fmtDate(iso)} ${fmtTime(iso)}` : '待排期';
}

/** 时刻 → HH:mm:ss(监控告警侧栏) */
export function fmtClock(epochMs: number): string {
  const d = new Date(epochMs);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}
