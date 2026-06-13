/**
 * 编排课堂流程(原型 v0.4 id=t-lesson)
 * 环节卡(上下移按钮替代拖拽 + 时长编辑 + 挂课件/试卷)+ 课堂 AI 设置 + 检查清单 + 发布(4201 弹缺失项)
 * 裁剪口径(MVP 手册 1.1):AI 设置只留「引导模式 + 卡住提醒」;拖拽、预览学生端延后
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { KpNodeDto, LessonDto, LessonSegmentDto, PaperDto, ResourceDto, SegmentType } from '@qiming/contracts';
import { Button, Card, EmptyState, Modal, Skeleton, Switch, Tag, useToast } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import {
  CHECKLIST_LABEL, SEGMENT_LABEL, bizError,
  missingLabels, moveSegment, newSegment, pendingPaperKeys, removeSegment, reseq, totalDuration,
} from './lib/segments';

const SEG_ICON: Record<SegmentType, { glyph: string; cls: string }> = {
  warmup: { glyph: '↻', cls: 'bg-orange-soft text-orange' },
  lecture: { glyph: '▶', cls: 'bg-primary-soft text-primary' },
  practice: { glyph: '✎', cls: 'bg-violet-soft text-violet' },
  summary: { glyph: '◎', cls: 'bg-green-soft text-green' },
  homework: { glyph: '⌂', cls: 'bg-red-soft text-red' },
  break_time: { glyph: '◷', cls: 'bg-bg text-ink-2' },
};

/** 可添加环节(MVP 4 类 + 小结;A4 发布清单要求五类齐备) */
const ADDABLE: SegmentType[] = ['warmup', 'lecture', 'practice', 'summary', 'homework'];
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

function AiChip() {
  return <span className="rounded-[6px] bg-violet-soft px-1.5 py-px text-[11px] font-bold text-violet">AI</span>;
}

const LINK_CLS = 'text-[13px] font-semibold text-primary hover:underline';

export function LessonArrangePage() {
  const { id } = useParams();
  const lessonId = Number(id);
  const navigate = useNavigate();
  const { toast } = useToast();

  const [lesson, setLesson] = useState<LessonDto | null>(null);
  const [segments, setSegments] = useState<LessonSegmentDto[] | null>(null);
  const [papers, setPapers] = useState<PaperDto[]>([]);
  const [resources, setResources] = useState<ResourceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  /** 4201 缺失项弹窗内容 */
  const [missing, setMissing] = useState<string[] | null>(null);
  /** 挂载弹窗:目标环节下标 */
  const [mountIdx, setMountIdx] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  /** 知识点选择弹窗:目标环节下标 */
  const [kpIdx, setKpIdx] = useState<number | null>(null);
  const [kpNodes, setKpNodes] = useState<KpNodeDto[]>([]);
  const [kpKeyword, setKpKeyword] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/lessons/{id}', { params: { id: lessonId } }),
      api.get('/lessons/{id}/segments', { params: { id: lessonId } }),
      api.get('/papers', { query: { page: 1, size: 50 } }),
      api.get('/resources', { query: { page: 1, size: 50 } }),
    ])
      .then(([l, s, p, r]) => {
        setLesson(l.data as LessonDto);
        setSegments(reseq(s.data as LessonSegmentDto[]));
        setPapers(p.data.items as PaperDto[]);
        setResources(r.data.items as ResourceDto[]);
      })
      .finally(() => setLoading(false));
  }, [lessonId]);

  // 知识点选择器数据源:教材知识图谱节点(可空标注)
  useEffect(() => {
    api.get('/kp/graphs')
      .then((g) => {
        const graph = g.data.find((x) => x.graphType === 'curriculum_knowledge') ?? g.data[0];
        if (!graph) return;
        return api.get('/kp/nodes', { query: { graphId: graph.id } }).then((n) => setKpNodes(n.data));
      })
      .catch(() => undefined);
  }, []);

  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  const resourceById = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources]);
  const paperStatus = useMemo(() => new Map(papers.map((p) => [p.id, p.status])), [papers]);
  const pendingPaper = useMemo(() => pendingPaperKeys(segments ?? [], paperStatus), [segments, paperStatus]);
  const practiceIdx = useMemo(() => (segments ?? []).findIndex((s) => s.type === 'practice'), [segments]);

  const update = (next: LessonSegmentDto[]) => { setSegments(next); setDirty(true); };
  const patchSeg = (idx: number, patch: Partial<LessonSegmentDto>) =>
    update((segments ?? []).map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const save = async (): Promise<boolean> => {
    if (!segments) return false;
    try {
      await api.put('/lessons/{id}/segments', { params: { id: lessonId }, body: reseq(segments) });
      setDirty(false);
      const l = await api.get('/lessons/{id}', { params: { id: lessonId } });
      setLesson(l.data as LessonDto);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败');
      return false;
    }
  };

  const publish = async () => {
    setBusy(true);
    try {
      if (!(await save())) return;
      await api.post('/lessons/{id}/publish', { params: { id: lessonId } });
      toast('课堂流程已发布,讲次已就绪');
      const l = await api.get('/lessons/{id}', { params: { id: lessonId } });
      setLesson(l.data as LessonDto);
    } catch (e) {
      const biz = bizError(e);
      if (biz?.code === 4201) {
        setMissing(missingLabels(biz.detail));
        const l = await api.get('/lessons/{id}', { params: { id: lessonId } }).catch(() => null);
        if (l) setLesson(l.data as LessonDto);
      } else {
        toast(e instanceof Error ? e.message : '发布失败');
      }
    } finally {
      setBusy(false);
    }
  };

  const segDesc = (s: LessonSegmentDto) => {
    if (s.type === 'warmup')
      return <>AI 自动带入上讲全班错误率最高的 {Number(s.config.count) || 3} 道题,逐题引导回顾 <AiChip /></>;
    if (s.type === 'lecture') {
      const r = s.resourceId != null ? resourceById.get(s.resourceId) : null;
      const cps = Array.isArray(s.config.checkpoints) ? s.config.checkpoints.length : 0;
      return r
        ? <>《{r.name}》{cps > 0 && ` · 含 ${cps} 个随堂小测打点`}</>
        : <span className="text-red">未挂载课件 —— 点右侧「挂载课件」选择资源</span>;
    }
    if (s.type === 'summary')
      return <>AI 按每个学生本堂错题生成 2–4 道巩固题,做完即下课 <AiChip /></>;
    // practice / homework:挂卷情况
    const p = s.paperId != null ? paperById.get(s.paperId) : null;
    if (!p) {
      return (
        <span className="text-red">
          {s.type === 'homework' ? '未配置 —— 下课后推送到学生平板,先去组卷' : '未挂载试卷'}
        </span>
      );
    }
    return <>《{p.name}》 · {p.questions.length} 题 · 共 {p.totalScore} 分{s.type === 'practice' && ' · AI 引导式答疑'}</>;
  };

  const mountSeg = mountIdx != null && segments ? segments[mountIdx] : null;
  const mountItems: { id: number; name: string; meta: string }[] = mountSeg?.type === 'lecture'
    ? resources.map((r) => ({ id: r.id, name: r.name, meta: r.type }))
    : (mountSeg ? papers.filter((p) => p.type === (mountSeg.type === 'homework' ? 'homework' : 'practice')) : [])
        .map((p) => ({ id: p.id, name: p.name, meta: `${p.questions.length} 题 · ${p.totalScore} 分` }));

  if (loading) {
    return (
      <div>
        <Skeleton className="mb-5 h-9 w-2/3" />
        <Skeleton lines={5} className="h-20 w-full" />
      </div>
    );
  }
  if (!lesson || !segments) {
    return <EmptyState icon="▦" text="讲次不存在" action={<Button onClick={() => navigate('/courses')}>返回讲次列表</Button>} />;
  }

  const homeworkSeg = segments.find((s) => s.type === 'homework');
  const paperBuilderTo = `/lessons/${lessonId}/paper${homeworkSeg?.paperId != null ? `?paperId=${homeworkSeg.paperId}` : ''}`;

  return (
    <div>
      <PageHead
        title={(
          <span>
            <Link className="text-[15px] font-semibold text-primary hover:underline" to={`/courses?courseId=${lesson.courseId}`}>← 讲次</Link>
            <span className="text-ink-3"> / </span>{lesson.title} · 编排课堂流程
          </span>
        )}
        sub={(
          <span className="inline-flex items-center gap-2">
            学生平板上课时,AI 将按以下环节依次带学生完成 · 总时长约 {totalDuration(segments)} 分钟
            {lesson.status === 'ready' && <Tag tone="green">已就绪</Tag>}
            {dirty && <Tag tone="orange">有未保存修改</Tag>}
          </span>
        )}
        actions={(
          <>
            <Button onClick={save} disabled={busy || !dirty}>保存编排</Button>
            <Button variant="primary" onClick={publish} disabled={busy}>发布课堂</Button>
          </>
        )}
      />

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
        {/* 左:环节卡列表 */}
        <div className="flex flex-col gap-3">
          {segments.length === 0 && (
            <div className="rounded-lg border border-line bg-card shadow-card">
              <EmptyState icon="▦" text="还没有课堂环节" hint="点击下方「添加环节」开始编排" />
            </div>
          )}
          {segments.map((s, i) => {
            const homeworkMissing = (s.type === 'homework' || s.type === 'practice')
              && (s.paperId == null || paperStatus.get(s.paperId) !== 'published');
            return (
              <div
                key={`${s.type}-${s.id ?? i}`}
                className={`flex items-center gap-3.5 rounded-lg border bg-card p-4 shadow-card ${
                  homeworkMissing ? 'border-dashed border-red' : 'border-line'
                }`}
              >
                {/* 上下移(替代拖拽) */}
                <div className="flex flex-col gap-1">
                  <button
                    type="button" aria-label={`上移环节 ${i + 1}`} disabled={i === 0}
                    onClick={() => update(moveSegment(segments, i, -1))}
                    className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line text-[11px] text-ink-2 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >▲</button>
                  <button
                    type="button" aria-label={`下移环节 ${i + 1}`} disabled={i === segments.length - 1}
                    onClick={() => update(moveSegment(segments, i, 1))}
                    className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line text-[11px] text-ink-2 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >▼</button>
                </div>
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-[16px] ${SEG_ICON[s.type].cls}`}>
                  {SEG_ICON[s.type].glyph}
                </div>
                <div className="min-w-0 flex-1">
                  <b className="text-sm">
                    {CIRCLED[i] ?? i + 1} {SEGMENT_LABEL[s.type]}
                    {homeworkMissing && <Tag tone="red" className="ml-2">未配置</Tag>}
                  </b>
                  <div className="mt-0.5 truncate text-[12.5px] text-ink-2">{segDesc(s)}</div>
                  <button
                    type="button"
                    onClick={() => { setKpKeyword(''); setKpIdx(i); }}
                    className="mt-1 inline-flex items-center gap-1 text-[12px]"
                    aria-label={`环节 ${i + 1} 知识点`}
                  >
                    {s.kpNodeName
                      ? <Tag tone="primary">📘 {s.kpNodeName}</Tag>
                      : <span className="text-ink-3 hover:text-primary hover:underline">＋ 标注知识点</span>}
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-ink-2">
                  <input
                    type="number" min={0} max={180}
                    className="w-14 rounded-[8px] border-[1.5px] border-line px-2 py-1 text-center text-[13px] tabular-nums focus:border-primary focus:outline-none"
                    value={s.durationMin}
                    onChange={(e) => patchSeg(i, { durationMin: Math.max(0, Number(e.target.value) || 0) })}
                    aria-label={`环节 ${i + 1} 时长(分钟)`}
                  />
                  分钟
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {s.type === 'lecture' && (
                    <button type="button" className={LINK_CLS} onClick={() => setMountIdx(i)}>
                      {s.resourceId != null ? '更换课件' : '挂载课件'}
                    </button>
                  )}
                  {s.type === 'practice' && (
                    <button type="button" className={LINK_CLS} onClick={() => setMountIdx(i)}>
                      {s.paperId != null ? '更换试卷' : '选择试卷'}
                    </button>
                  )}
                  {s.type === 'homework' && (
                    <>
                      <Link className={LINK_CLS} to={paperBuilderTo}>去题库组卷</Link>
                      <button type="button" className={LINK_CLS} onClick={() => setMountIdx(i)}>选择已有试卷</button>
                    </>
                  )}
                  <button type="button" className="text-[13px] font-medium text-red hover:underline" onClick={() => update(removeSegment(segments, i))}>
                    移除
                  </button>
                </div>
              </div>
            );
          })}

          {/* 添加环节 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              className="w-full rounded-lg border-[1.5px] border-dashed border-line bg-card py-3 text-[13.5px] font-semibold text-ink-2 hover:border-primary hover:text-primary"
            >
              + 添加环节
            </button>
            {addOpen && (
              <div className="absolute left-1/2 z-10 mt-1.5 flex -translate-x-1/2 gap-2 rounded-md border border-line bg-card p-2 shadow-card">
                {ADDABLE.map((t) => (
                  <button
                    key={t} type="button"
                    className="rounded-[8px] border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink-2 hover:border-primary hover:text-primary"
                    onClick={() => { update(reseq([...segments, newSegment(t, segments.length + 1)])); setAddOpen(false); }}
                  >
                    {SEGMENT_LABEL[t]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右:AI 设置 + 检查清单 */}
        <div className="flex flex-col gap-3.5">
          {practiceIdx >= 0 && (
            <Card title={<span className="inline-flex items-center gap-2">课堂 AI 设置 <AiChip /></span>}>
              <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
                <div>
                  <b className="text-[13.5px]">引导模式</b>
                  <div className="text-xs text-ink-3">答疑只引导思路,不直接报答案</div>
                </div>
                <Switch
                  label="引导模式"
                  checked={segments[practiceIdx].config.ai_guide !== false}
                  onChange={(v) => patchSeg(practiceIdx, { config: { ...segments[practiceIdx].config, ai_guide: v } })}
                />
              </div>
              <div className="flex items-center justify-between gap-3 pt-3">
                <div>
                  <b className="text-[13.5px]">卡住提醒老师</b>
                  <div className="text-xs text-ink-3">学生在一题停留超 3 分钟,提醒巡堂老师</div>
                </div>
                <Switch
                  label="卡住提醒老师"
                  checked={Number(segments[practiceIdx].config.stuck_alert_min) > 0}
                  onChange={(v) => patchSeg(practiceIdx, { config: { ...segments[practiceIdx].config, stuck_alert_min: v ? 3 : 0 } })}
                />
              </div>
            </Card>
          )}
          <Card title="发布门槛">
            <div className="flex flex-col gap-2 text-[13px] leading-relaxed">
              <div className="text-ink-2">环节可自由增删、调序,并按需标注知识点;发布无需四类齐全。</div>
              {pendingPaper.length === 0 ? (
                <div className="text-green">✅ 暂无待补项,本讲可随时发布</div>
              ) : (
                pendingPaper.map((k) => (
                  <div key={k} className="font-semibold text-red">
                    ❌ {CHECKLIST_LABEL[k]}环节需挂一份「已发布」试卷
                  </div>
                ))
              )}
              <div className="mt-1.5 text-xs text-ink-3">仅随堂练 / 课后作业未挂已发布试卷会拦截发布{dirty && ';当前修改未保存,发布时会自动保存'}</div>
            </div>
          </Card>
        </div>
      </div>

      {/* 4201:缺失项弹窗 */}
      <Modal
        open={missing != null}
        title="备课检查未通过"
        onClose={() => setMissing(null)}
        footer={(
          <>
            <Button onClick={() => setMissing(null)}>继续编排</Button>
            {missing?.includes(CHECKLIST_LABEL.homework) && (
              <Button variant="primary" onClick={() => navigate(paperBuilderTo)}>去组卷配置课后作业</Button>
            )}
          </>
        )}
      >
        <div className="text-[13.5px] text-ink-2">以下环节还未就绪,补齐后才能发布课堂:</div>
        <div className="mt-3 flex flex-col gap-2">
          {(missing ?? []).map((m) => (
            <div key={m} className="rounded-md bg-red-soft px-3.5 py-2.5 text-[13.5px] font-semibold text-red">✕ {m}</div>
          ))}
        </div>
      </Modal>

      {/* 挂载课件 / 选择试卷弹窗 */}
      <Modal
        open={mountSeg != null}
        title={mountSeg?.type === 'lecture' ? '挂载课件' : '选择试卷'}
        onClose={() => setMountIdx(null)}
      >
        {mountItems.length === 0 ? (
          <EmptyState
            icon="▣"
            text={mountSeg?.type === 'lecture' ? '资源库暂无课件' : '暂无可用试卷'}
            hint={mountSeg?.type === 'homework' ? '可点击「去题库组卷」新建一份作业卷' : undefined}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {mountItems.map((it) => {
              const selected = mountSeg?.type === 'lecture' ? mountSeg.resourceId === it.id : mountSeg?.paperId === it.id;
              return (
                <button
                  key={it.id} type="button"
                  className={`flex items-center justify-between rounded-md border-[1.5px] px-3.5 py-2.5 text-left text-[13.5px] ${
                    selected ? 'border-primary bg-primary-soft font-bold text-primary' : 'border-line hover:border-ink-3'
                  }`}
                  onClick={() => {
                    if (mountIdx == null || !mountSeg) return;
                    patchSeg(mountIdx, mountSeg.type === 'lecture' ? { resourceId: it.id } : { paperId: it.id });
                    setMountIdx(null);
                  }}
                >
                  <span>{it.name}</span>
                  <small className="text-xs text-ink-3">{it.meta}</small>
                </button>
              );
            })}
          </div>
        )}
      </Modal>

      {/* 知识点选择弹窗(可空标注;写 segment.kpNodeId) */}
      <Modal
        open={kpIdx != null}
        title="标注知识点"
        onClose={() => setKpIdx(null)}
      >
        <div className="mb-3">
          <input
            value={kpKeyword}
            onChange={(e) => setKpKeyword(e.target.value)}
            placeholder="搜索知识点名称"
            className="w-full rounded-[10px] border-[1.5px] border-line px-3 py-2 text-[13px] outline-none focus:border-primary"
          />
        </div>
        <button
          type="button"
          className="mb-2 w-full rounded-md border-[1.5px] border-line px-3.5 py-2.5 text-left text-[13px] text-ink-2 hover:border-ink-3"
          onClick={() => { if (kpIdx != null) patchSeg(kpIdx, { kpNodeId: null, kpNodeName: null }); setKpIdx(null); }}
        >
          不标注知识点(清除)
        </button>
        {kpNodes.length === 0 ? (
          <EmptyState icon="▦" text="暂无可选知识点" hint="教材知识图谱未加载或为空" />
        ) : (
          <div className="flex max-h-[46vh] flex-col gap-1.5 overflow-auto">
            {kpNodes
              .filter((n) => !kpKeyword.trim() || n.name.includes(kpKeyword.trim()))
              .map((n) => {
                const selected = kpIdx != null && segments[kpIdx]?.kpNodeId === n.id;
                return (
                  <button
                    key={n.id} type="button"
                    className={`flex items-center justify-between rounded-md border-[1.5px] px-3.5 py-2.5 text-left text-[13.5px] ${
                      selected ? 'border-primary bg-primary-soft font-bold text-primary' : 'border-line hover:border-ink-3'
                    }`}
                    onClick={() => { if (kpIdx != null) patchSeg(kpIdx, { kpNodeId: n.id, kpNodeName: n.name }); setKpIdx(null); }}
                  >
                    <span>{n.name}</span>
                    {n.chapter && <small className="text-xs text-ink-3">{n.chapter}</small>}
                  </button>
                );
              })}
          </div>
        )}
      </Modal>
    </div>
  );
}
