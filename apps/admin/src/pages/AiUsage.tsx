/** AI 用量与开销(原型 a-ai,按裁剪表:摘要卡 + 日曲线 + 按功能拆分 + 固定告警;按课程拆分延后) */
import { useCallback, useEffect, useState } from 'react';
import type { AiUsageBreakdownDto, AiUsageSummaryDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Modal, ProgressBar, Skeleton, StatCard, useToast } from '@qiming/ui';
import { api } from '../api';
import { BarChart } from '../components/BarChart';
import { Field, FormRow, Select, TextInput } from '../components/controls';
import { formatDayShort, formatMoney, formatWan } from '../lib/format';
import { OVER_POLICY_LABEL } from '../lib/labels';
import { validateQuota } from '../lib/validate';
import { PageHead } from './Shell';

interface DailyItem { date: string; tokens: number; cost: number }
interface Quota { monthlyLimit: number; alertThreshold: number; overPolicy: string }

/** 拆分条配色按原型顺序循环:主色 / 紫 / 橙 / 绿 */
const BREAKDOWN_FILL = ['bg-primary', 'bg-violet', 'bg-orange', 'bg-green'] as const;

export function AiUsage() {
  const [summary, setSummary] = useState<AiUsageSummaryDto | null>(null);
  const [daily, setDaily] = useState<DailyItem[]>([]);
  const [breakdown, setBreakdown] = useState<AiUsageBreakdownDto[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [s, d, b, q] = await Promise.all([
        api.get('/admin/ai-usage/summary'),
        api.get('/admin/ai-usage/daily', { query: { days: 14 } }),
        api.get('/admin/ai-usage/breakdown'),
        api.get('/admin/ai-quota'),
      ]);
      setSummary(s.data);
      setDaily(d.data as DailyItem[]);
      setBreakdown(b.data);
      setQuota(q.data as Quota);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const alertCount = summary && quota && summary.usedPercent >= quota.alertThreshold ? 1 : 0;
  const avgDailyTokens = daily.length ? daily.reduce((acc, d) => acc + d.tokens, 0) / daily.length : 0;

  return (
    <div>
      <PageHead
        title="AI 用量与开销"
        sub={`统计口径:大模型 Token 消耗${quota ? ` · 本月额度 ${formatMoney(quota.monthlyLimit)}` : ''}`}
        actions={<Button variant="primary" onClick={() => setQuotaOpen(true)} disabled={!quota}>额度与告警设置</Button>}
      />

      {failed ? (
        <Card><EmptyState text="用量数据加载失败" hint="请检查后端或 mock 是否就绪" action={<Button onClick={() => void load()}>重试</Button>} /></Card>
      ) : loading || !summary || !quota ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[108px] w-full !rounded-lg" />)}
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Skeleton className="h-[240px] w-full !rounded-lg" />
            <Skeleton className="h-[240px] w-full !rounded-lg" />
          </div>
        </>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard
              ribbon="primary"
              label="本月 Token 消耗"
              value={<>{formatWan(summary.totalTokens)}<span className="text-[15px] font-semibold text-ink-2"> 万</span></>}
              delta={`日均 ${formatWan(avgDailyTokens)} 万(近 14 日)`}
            />
            <StatCard
              ribbon="orange"
              label="本月预估费用"
              value={formatMoney(summary.totalCost)}
              delta={
                <span>
                  额度 {formatMoney(summary.monthlyLimit)} · 已用 {summary.usedPercent}%
                  <ProgressBar
                    className="mt-2 !h-2"
                    value={summary.usedPercent}
                    tone={summary.usedPercent >= quota.alertThreshold ? 'red' : summary.usedPercent >= 60 ? 'orange' : 'primary'}
                  />
                </span>
              }
            />
            <StatCard
              ribbon="green"
              label="课均 AI 成本"
              value={
                summary.avgCostPerLesson != null
                  ? <>¥{summary.avgCostPerLesson}<span className="text-[13px] font-semibold text-ink-2"> /课次</span></>
                  : '—'
              }
              delta="按本月已上课次折算"
            />
            <StatCard
              ribbon="red"
              label="用量告警"
              value={alertCount}
              delta={
                alertCount
                  ? `已用 ${summary.usedPercent}%,超过告警阈值 ${quota.alertThreshold}%`
                  : `告警阈值 ${quota.alertThreshold}% · 当前已用 ${summary.usedPercent}%`
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="近 14 日 Token 消耗(万)">
              {daily.length === 0 ? (
                <EmptyState text="本月暂无用量记录" />
              ) : (
                <BarChart
                  data={daily.map((d, i) => ({
                    label: i === daily.length - 1 ? '今天' : formatDayShort(d.date),
                    value: Math.round(d.tokens / 10000),
                    hi: i === daily.length - 1,
                  }))}
                />
              )}
            </Card>
            <Card title="按功能拆分(本月)">
              {breakdown.length === 0 ? (
                <EmptyState text="本月暂无用量记录" />
              ) : (
                <div className="flex flex-col gap-3.5">
                  {breakdown.map((b, i) => (
                    <div key={b.key}>
                      <div className="mb-1.5 flex justify-between text-[12.5px]">
                        <span className="text-ink-2">{b.label}</span>
                        <b className="tabular-nums text-ink">{b.percent}% · {formatMoney(b.cost)}</b>
                      </div>
                      <div className="h-2 overflow-hidden rounded-pill bg-bg">
                        <div className={`h-full rounded-pill ${BREAKDOWN_FILL[i % BREAKDOWN_FILL.length]}`} style={{ width: `${b.percent}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {quota && (
        <QuotaModal
          open={quotaOpen}
          initial={quota}
          onClose={() => setQuotaOpen(false)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
}

/** 额度与告警设置弹窗(原型 modalQuota) */
function QuotaModal({ open, initial, onClose, onSaved }: { open: boolean; initial: Quota; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) { setForm(initial); setErrors({}); }
  }, [open, initial]);

  const submit = async () => {
    const errs = validateQuota(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.put('/admin/ai-quota', {
        body: { monthlyLimit: form.monthlyLimit, alertThreshold: form.alertThreshold, overPolicy: form.overPolicy as 'disable_qa' | 'pause_all' | 'record_only' },
      });
      toast('额度与告警设置已保存');
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败,请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="AI 额度与告警设置"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : '保存'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormRow>
          <Field label="月度额度(元)" error={errors.monthlyLimit}>
            <TextInput
              type="number" min={1}
              value={form.monthlyLimit}
              onChange={(e) => setForm((f) => ({ ...f, monthlyLimit: Number(e.target.value) }))}
            />
          </Field>
          <Field label="告警阈值" error={errors.alertThreshold}>
            <Select value={form.alertThreshold} onChange={(e) => setForm((f) => ({ ...f, alertThreshold: Number(e.target.value) }))}>
              <option value={60}>达 60% 时通知管理员</option>
              <option value={80}>达 80% 时通知管理员</option>
              <option value={90}>达 90% 时通知管理员</option>
            </Select>
          </Field>
        </FormRow>
        <Field label="超出额度后" error={errors.overPolicy}>
          <Select value={form.overPolicy} onChange={(e) => setForm((f) => ({ ...f, overPolicy: e.target.value }))}>
            {Object.entries(OVER_POLICY_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
