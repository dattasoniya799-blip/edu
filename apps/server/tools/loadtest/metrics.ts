/**
 * D4 压测 · 指标采集与报表(零外部依赖)
 * 每个 label(≈端点)累计 count / errors / 延迟样本,报表输出 P50/P95/P99/avg/max 与总 RPS。
 */

export interface LabelStat {
  label: string;
  count: number;
  errors: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  max: number;
}

export interface Totals {
  requests: number;
  errors: number;
  errorRate: number;
  rps: number;
  elapsedSec: number;
}

/** 已排序数组的分位数(最近邻法) */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export class Recorder {
  private stats = new Map<string, { durations: number[]; errors: number; count: number }>();

  record(label: string, ms: number, ok: boolean): void {
    let s = this.stats.get(label);
    if (!s) {
      s = { durations: [], errors: 0, count: 0 };
      this.stats.set(label, s);
    }
    s.count += 1;
    s.durations.push(ms);
    if (!ok) s.errors += 1;
  }

  snapshot(): LabelStat[] {
    const rows: LabelStat[] = [];
    for (const [label, s] of this.stats) {
      const sorted = [...s.durations].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      rows.push({
        label,
        count: s.count,
        errors: s.errors,
        errorRate: s.count ? s.errors / s.count : 0,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        avg: s.count ? sum / s.count : 0,
        max: sorted[sorted.length - 1] ?? 0,
      });
    }
    return rows.sort((a, b) => a.label.localeCompare(b.label));
  }

  totals(elapsedSec: number): Totals {
    let requests = 0;
    let errors = 0;
    for (const s of this.stats.values()) {
      requests += s.count;
      errors += s.errors;
    }
    return {
      requests,
      errors,
      errorRate: requests ? errors / requests : 0,
      rps: elapsedSec > 0 ? requests / elapsedSec : 0,
      elapsedSec,
    };
  }
}

const pad = (v: string | number, w: number, left = false) => {
  const s = String(v);
  return left ? s.padEnd(w) : s.padStart(w);
};

export function renderTable(rows: LabelStat[]): string {
  const labelW = Math.max(28, ...rows.map((r) => r.label.length + 2));
  const head = `${pad('端点', labelW, true)}${pad('count', 8)}${pad('err', 6)}${pad('err%', 8)}${pad('P50', 9)}${pad('P95', 9)}${pad('P99', 9)}${pad('avg', 9)}${pad('max', 9)}`;
  const sep = '-'.repeat(head.length);
  const lines = rows.map(
    (r) =>
      `${pad(r.label, labelW, true)}${pad(r.count, 8)}${pad(r.errors, 6)}` +
      `${pad((r.errorRate * 100).toFixed(2), 8)}${pad(r.p50.toFixed(0), 9)}${pad(r.p95.toFixed(0), 9)}` +
      `${pad(r.p99.toFixed(0), 9)}${pad(r.avg.toFixed(0), 9)}${pad(r.max.toFixed(0), 9)}`,
  );
  return [head, sep, ...lines].join('\n');
}
