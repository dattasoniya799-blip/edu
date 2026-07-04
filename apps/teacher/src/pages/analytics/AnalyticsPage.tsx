/**
 * 学情分析(B4:知识点掌握热力 + 待关注名单 + 单生下钻 + AI 诊断)
 * 数据端点(真实后端已实现,mock 亦补齐):
 *   GET  /analytics/courses/{id}/mastery    课程知识点掌握热力 [{nodeId,nodeName,avgMastery,studentCount}]
 *   GET  /analytics/courses/{id}/attention  待关注学生名单     [{studentId,name,reason}]
 *   GET  /analytics/students/{id}           单生 30 天报告     {mastery[],wrongOpenCount,attempts30d}
 *   POST /analytics/students/{id}/diagnose  AI 学情诊断        AiDiagnosisDto {summary,weakPoints[]}
 * 结构:选课程 → 掌握度热力图 + 待关注名单 → 点学生下钻看详情 + AI 诊断。
 * 口径:热力/名单为课程级;下钻只能选「待关注名单」里的学生(现有端点未提供全员列表)。
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AiDiagnosisDto, CourseDto, MasteryItemDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Skeleton, StatCard, Tag, useToast } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import { fmtDateTime } from '../course/lib/format';

interface MasteryHeatCell { nodeId: number; nodeName: string; avgMastery: number; studentCount: number }
interface AttentionItem { studentId: number; name: string; reason: string }
interface StudentReport { mastery: MasteryItemDto[]; wrongOpenCount: number; attempts30d: number }

/** 掌握度分档配色(与全局 soft 色板一致;bar 用字面类名,避免 Tailwind 扫描不到) */
function masteryTone(pct: number): { bg: string; text: string; bar: string; label: string } {
  if (pct >= 80) return { bg: 'bg-green-soft', text: 'text-green', bar: 'bg-green', label: '掌握好' };
  if (pct >= 60) return { bg: 'bg-primary-soft', text: 'text-primary', bar: 'bg-primary', label: '一般' };
  if (pct >= 40) return { bg: 'bg-orange-soft', text: 'text-orange', bar: 'bg-orange', label: '偏弱' };
  return { bg: 'bg-red-soft', text: 'text-red', bar: 'bg-red', label: '薄弱' };
}

export function AnalyticsPage() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [courses, setCourses] = useState<CourseDto[]>([]);
  const [heat, setHeat] = useState<MasteryHeatCell[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  // 单生下钻
  const [selected, setSelected] = useState<AttentionItem | null>(null);
  const [report, setReport] = useState<StudentReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  // AI 诊断
  const [diagnosis, setDiagnosis] = useState<AiDiagnosisDto | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  const courseId = Number(searchParams.get('courseId')) || courses[0]?.id || 0;
  const course = courses.find((c) => c.id === courseId);

  useEffect(() => {
    api.get('/teacher/courses').then((r) => setCourses(r.data as CourseDto[])).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!courseId) return;
    setLoading(true);
    setError(false);
    setSelected(null);
    setReport(null);
    setDiagnosis(null);
    Promise.all([
      api.get('/analytics/courses/{id}/mastery', { params: { id: courseId } }),
      api.get('/analytics/courses/{id}/attention', { params: { id: courseId } }),
    ])
      .then(([m, a]) => {
        setHeat(m.data as MasteryHeatCell[]);
        setAttention(a.data as AttentionItem[]);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [courseId, reload]);

  // 选中学生 → 拉 30 天报告
  useEffect(() => {
    if (!selected) { setReport(null); return; }
    let alive = true;
    setReportLoading(true);
    setDiagnosis(null);
    api.get('/analytics/students/{id}', { params: { id: selected.studentId } })
      .then((r) => { if (alive) setReport(r.data as StudentReport); })
      .catch(() => { if (alive) setReport(null); })
      .finally(() => { if (alive) setReportLoading(false); });
    return () => { alive = false; };
  }, [selected]);

  const runDiagnose = async () => {
    if (!selected) return;
    setDiagnosing(true);
    try {
      const r = await api.post('/analytics/students/{id}/diagnose', { params: { id: selected.studentId } });
      setDiagnosis(r.data as AiDiagnosisDto);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'AI 诊断失败,请稍后重试');
    } finally {
      setDiagnosing(false);
    }
  };

  return (
    <div>
      <PageHead
        title="学情分析"
        sub={course
          ? `${course.name} · 知识点掌握热力 + 待关注学生(近 30 天口径)`
          : '知识点掌握热力 + 待关注名单 · 点学生下钻看详情 + AI 诊断'}
        actions={courses.length > 0 && (
          <select
            className="cursor-pointer rounded-[10px] border-[1.5px] border-line bg-card px-3 py-2 text-[13.5px] font-semibold focus:border-primary focus:outline-none"
            value={courseId || ''}
            onChange={(e) => setSearchParams({ courseId: e.target.value })}
            aria-label="切换课程"
          >
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      />

      {loading ? (
        <div className="grid gap-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton lines={3} className="h-32 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState icon="⚠" text="学情数据加载失败" hint="可能是网络波动,请重试"
            action={<Button variant="primary" onClick={() => setReload((n) => n + 1)}>重新加载</Button>} />
        </div>
      ) : (
        <>
          {/* 知识点掌握热力 */}
          <Card title="知识点掌握热力" className="mb-4" extra={<span className="text-[12px] text-ink-3">按班级平均掌握率分档:掌握好 ≥80 · 一般 ≥60 · 偏弱 ≥40 · 薄弱 &lt;40</span>}>
            {heat.length === 0 ? (
              <EmptyState icon="◔" text="暂无掌握度数据" hint="学生完成练习并出分后,这里按知识点显示班级平均掌握率" className="py-8" />
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                {heat.map((cell) => {
                  const tone = masteryTone(cell.avgMastery);
                  return (
                    <div key={cell.nodeId} className={`rounded-lg border border-line p-3 ${tone.bg}`}>
                      <div className="flex items-start justify-between gap-2">
                        <b className="text-[13px] leading-snug text-ink">{cell.nodeName}</b>
                        <span className={`shrink-0 text-[11px] font-bold ${tone.text}`}>{tone.label}</span>
                      </div>
                      <div className={`mt-2 text-[22px] font-extrabold tabular-nums ${tone.text}`}>{cell.avgMastery}%</div>
                      <div className="mt-0.5 text-[11.5px] tabular-nums text-ink-3">{cell.studentCount} 名学生样本</div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0,360px) minmax(0,1fr)' }}>
            {/* 待关注名单 */}
            <Card title={<span>待关注学生 <span className="tabular-nums text-ink-3">· {attention.length} 人</span></span>} bodyClassName="p-0">
              {attention.length === 0 ? (
                <EmptyState icon="✓" text="暂无待关注学生" hint="全班掌握情况良好,无明显掉队学生" className="py-8" />
              ) : (
                <div className="flex flex-col">
                  {attention.map((s) => {
                    const active = selected?.studentId === s.studentId;
                    return (
                      <button
                        key={s.studentId}
                        type="button"
                        onClick={() => setSelected(s)}
                        className={`flex items-start gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 ${
                          active ? 'bg-primary-soft' : 'hover:bg-bg'
                        }`}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-orange-soft text-[13px] font-extrabold text-orange">
                          {s.name.slice(0, 1)}
                        </div>
                        <div className="min-w-0">
                          <b className={`text-[13.5px] ${active ? 'text-primary' : 'text-ink'}`}>{s.name}</b>
                          <div className="text-[12px] leading-snug text-ink-2">{s.reason}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* 单生下钻 + AI 诊断 */}
            {!selected ? (
              <Card title="学生详情">
                <EmptyState icon="◔" text="选择左侧待关注学生查看详情" hint="点名单里的学生:看其近 30 天掌握度、错题量,并可一键 AI 诊断" className="py-10" />
              </Card>
            ) : (
              <div className="flex flex-col gap-4">
                <Card
                  title={<span>{selected.name} · 近 30 天</span>}
                  extra={<Button variant="primary" onClick={runDiagnose} disabled={diagnosing || reportLoading}>{diagnosing ? 'AI 诊断中…' : '✦ AI 诊断'}</Button>}
                >
                  {reportLoading ? (
                    <Skeleton lines={3} className="h-24 w-full" />
                  ) : !report ? (
                    <EmptyState icon="⚠" text="未能加载该生报告" className="py-6" />
                  ) : (
                    <>
                      <div className="mb-4 grid grid-cols-2 gap-3">
                        <StatCard ribbon="primary" label="近 30 天作答" value={`${report.attempts30d} 套`} delta="含课堂练/作业" />
                        <StatCard ribbon="red" label="未消化错题" value={report.wrongOpenCount} delta="错题本待订正" />
                      </div>
                      {report.mastery.length === 0 ? (
                        <EmptyState icon="◔" text="暂无掌握度明细" className="py-4" />
                      ) : (
                        <div className="flex flex-col gap-2">
                          {report.mastery.map((m) => {
                            const tone = masteryTone(m.mastery);
                            return (
                              <div key={m.nodeId} className="flex items-center gap-3">
                                <span className="w-40 shrink-0 truncate text-[13px] text-ink">{m.nodeName}</span>
                                <div className="h-2 flex-1 overflow-hidden rounded-pill bg-bg">
                                  <div className={`h-full rounded-pill ${tone.bar}`} style={{ width: `${Math.min(100, m.mastery)}%` }} />
                                </div>
                                <span className={`w-10 shrink-0 text-right text-[12.5px] font-bold tabular-nums ${tone.text}`}>{m.mastery}%</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </Card>

                {diagnosis && (
                  <Card title={<span className="inline-flex items-center gap-2">AI 学情诊断 <Tag tone="violet">AI</Tag></span>}>
                    <p className="text-[13.5px] leading-[1.9] text-ink">{diagnosis.summary}</p>
                    {diagnosis.weakPoints && diagnosis.weakPoints.length > 0 && (
                      <div className="mt-3 flex flex-col gap-2">
                        <div className="text-[12px] font-semibold text-ink-2">薄弱知识点</div>
                        {diagnosis.weakPoints.map((w, i) => (
                          <div key={i} className="rounded-md border border-line bg-bg px-3 py-2">
                            <b className="text-[13px] text-red">{w.kpName}</b>
                            <div className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{w.reason}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {diagnosis.generatedAt && (
                      <div className="mt-3 text-[11.5px] text-ink-3">生成于 {fmtDateTime(diagnosis.generatedAt)} · 结果仅供参考,请结合课堂观察判断</div>
                    )}
                  </Card>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
