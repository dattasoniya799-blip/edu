/**
 * 编排课堂 · 知识点单元(C2 #5,原型 v0.4 id=t-lesson 的结构化重构)
 *
 * 整页 = 开场白(可选,编辑 lesson.openingConfig)+ 多个「知识点单元」。
 * 每个知识点单元 = 选一个知识点(kpNode)+ 三段固定内容槽:
 *   讲解(挂 PPT/PDF resource)/ 随堂练(挂题目卷 paper)/ 小结巩固(config)。
 * 可增删单元、排序。保存转成 lesson_segments PUT(每单元三段,同 unitSeq+kpNodeId);
 * 开场白存 lesson.openingConfig。软提示三段建议齐全;发布 4201 弹缺失项。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { KpNodeDto, LessonDto, LessonSegmentDto, PaperDto, ResourceDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Modal, Skeleton, Tag, useToast } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import { CHECKLIST_LABEL, bizError, missingLabels, pendingPaperKeys } from './lib/segments';
import {
  UNIT_SLOT_LABEL, newUnit, openingFromLesson, openingToConfig,
  segmentsToUnits, unitWarnings, unitsDuration, unitsToSegments,
  type KpUnit, type OpeningConfig, type UnitSlotType,
} from './lib/units';

const LINK_CLS = 'text-[13px] font-semibold text-primary hover:underline';
const SLOT_ICON: Record<UnitSlotType, { glyph: string; cls: string }> = {
  lecture: { glyph: '▶', cls: 'bg-primary-soft text-primary' },
  practice: { glyph: '✎', cls: 'bg-violet-soft text-violet' },
  summary: { glyph: '◎', cls: 'bg-green-soft text-green' },
};
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

function AiChip() {
  return <span className="rounded-[6px] bg-violet-soft px-1.5 py-px text-[11px] font-bold text-violet">AI</span>;
}

export function LessonArrangePage() {
  const { id } = useParams();
  const lessonId = Number(id);
  const navigate = useNavigate();
  const { toast } = useToast();

  const [lesson, setLesson] = useState<LessonDto | null>(null);
  const [units, setUnits] = useState<KpUnit[] | null>(null);
  const [opening, setOpening] = useState<OpeningConfig>({ enabled: false, text: '', resourceId: null });
  const [papers, setPapers] = useState<PaperDto[]>([]);
  const [resources, setResources] = useState<ResourceDto[]>([]);
  const [kpNodes, setKpNodes] = useState<KpNodeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [missing, setMissing] = useState<string[] | null>(null);
  /** 挂载弹窗:{unitIdx, slot} 或 opening 资源 */
  const [mount, setMount] = useState<{ unitIdx: number; slot: 'lecture' | 'practice' } | 'opening' | null>(null);
  /** 知识点选择弹窗目标单元 */
  const [kpIdx, setKpIdx] = useState<number | null>(null);
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
        const lessonDto = l.data as LessonDto;
        setLesson(lessonDto);
        setOpening(openingFromLesson(lessonDto));
        setUnits(segmentsToUnits(s.data as LessonSegmentDto[]));
        setPapers(p.data.items as PaperDto[]);
        setResources(r.data.items as ResourceDto[]);
      })
      .finally(() => setLoading(false));
  }, [lessonId]);

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
  const segmentsPreview = useMemo(() => (units ? unitsToSegments(units) : []), [units]);
  const pendingPaper = useMemo(() => pendingPaperKeys(segmentsPreview, paperStatus), [segmentsPreview, paperStatus]);

  const update = (next: KpUnit[]) => { setUnits(next); setDirty(true); };
  const patchSlot = (unitIdx: number, slot: UnitSlotType, patch: Partial<KpUnit['lecture']>) =>
    update((units ?? []).map((u, i) => (i === unitIdx ? { ...u, [slot]: { ...u[slot], ...patch } } : u)));
  const patchOpening = (patch: Partial<OpeningConfig>) => { setOpening((o) => ({ ...o, ...patch })); setDirty(true); };

  const moveUnit = (idx: number, dir: -1 | 1) => {
    if (!units) return;
    const t = idx + dir;
    if (t < 0 || t >= units.length) return;
    const next = [...units];
    [next[idx], next[t]] = [next[t], next[idx]];
    update(next.map((u, i) => ({ ...u, unitSeq: i + 1 })));
  };

  const save = async (): Promise<boolean> => {
    if (!units) return false;
    try {
      // 开场白经 PUT /lessons/{id} 持久化(契约 body 已含 openingConfig,2026-06-13 整合补齐)
      await api.put('/lessons/{id}', {
        params: { id: lessonId },
        body: { openingConfig: openingToConfig(opening) },
      });
      await api.put('/lessons/{id}/segments', { params: { id: lessonId }, body: unitsToSegments(units) });
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
      toast('课堂已发布,讲次已就绪');
      const l = await api.get('/lessons/{id}', { params: { id: lessonId } });
      setLesson(l.data as LessonDto);
    } catch (e) {
      const biz = bizError(e);
      if (biz?.code === 4201) {
        setMissing(missingLabels(biz.detail));
      } else {
        toast(e instanceof Error ? e.message : '发布失败');
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div>
        <Skeleton className="mb-5 h-9 w-2/3" />
        <Skeleton lines={5} className="h-20 w-full" />
      </div>
    );
  }
  if (!lesson || !units) {
    return <EmptyState icon="▦" text="讲次不存在" action={<Button onClick={() => navigate('/courses')}>返回讲次列表</Button>} />;
  }

  // 挂载弹窗候选
  const mountIsOpening = mount === 'opening';
  const mountSlot = mount && mount !== 'opening' ? mount.slot : (mountIsOpening ? 'lecture' : null);
  const mountItems: { id: number; name: string; meta: string }[] =
    mountSlot === 'lecture'
      ? resources.map((r) => ({ id: r.id, name: r.name, meta: r.type }))
      : mountSlot === 'practice'
        ? papers.filter((p) => p.type === 'practice').map((p) => ({ id: p.id, name: p.name, meta: `${p.questions.length} 题 · ${p.totalScore} 分` }))
        : [];
  const mountSelectedId = mountIsOpening
    ? opening.resourceId
    : mount
      ? (mount.slot === 'lecture' ? units[mount.unitIdx]?.lecture.resourceId : units[mount.unitIdx]?.practice.paperId)
      : null;

  return (
    <div>
      <PageHead
        title={(
          <span>
            <Link className="text-[15px] font-semibold text-primary hover:underline" to={`/courses?courseId=${lesson.courseId}`}>← 讲次</Link>
            <span className="text-ink-3"> / </span>{lesson.title} · 编排课堂
          </span>
        )}
        sub={(
          <span className="inline-flex items-center gap-2">
            按「知识点单元」编排:开场白 + 若干单元(讲解 · 随堂练 · 小结)· 共 {units.length} 个单元 · 约 {unitsDuration(units)} 分钟
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
        <div className="flex flex-col gap-3">
          {/* 开场白 */}
          <div className="rounded-lg border border-line bg-card p-4 shadow-card">
            <div className="flex items-center justify-between">
              <b className="text-sm">开场白 <span className="text-[12px] font-normal text-ink-3">(可选 · 上课先做引入)</span></b>
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2">
                <input
                  type="checkbox" checked={opening.enabled}
                  onChange={(e) => patchOpening({ enabled: e.target.checked })}
                  aria-label="启用开场白"
                />
                启用开场白
              </label>
            </div>
            {opening.enabled && (
              <div className="mt-3 flex flex-col gap-2.5">
                <textarea
                  value={opening.text}
                  onChange={(e) => patchOpening({ text: e.target.value })}
                  placeholder="开场引导语,如:上节课我们学了……今天我们来研究图象平移。"
                  aria-label="开场白文本"
                  className="min-h-[64px] resize-y rounded-[10px] border-[1.5px] border-line px-3 py-2 text-[13px] outline-none focus:border-primary"
                />
                <div className="flex items-center gap-3 text-[12.5px] text-ink-2">
                  {opening.resourceId != null
                    ? <Tag tone="primary">📎 {resourceById.get(opening.resourceId)?.name ?? `资源 #${opening.resourceId}`}</Tag>
                    : <span className="text-ink-3">未挂课件</span>}
                  <button type="button" className={LINK_CLS} onClick={() => setMount('opening')}>
                    {opening.resourceId != null ? '更换课件' : '挂载课件(可选)'}
                  </button>
                  {opening.resourceId != null && (
                    <button type="button" className="text-[13px] font-medium text-red hover:underline" onClick={() => patchOpening({ resourceId: null })}>移除</button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 知识点单元卡 */}
          {units.length === 0 && (
            <div className="rounded-lg border border-line bg-card shadow-card">
              <EmptyState icon="▦" text="还没有知识点单元" hint="点击下方「添加知识点单元」开始编排" />
            </div>
          )}
          {units.map((u, i) => {
            const warnings = unitWarnings(u);
            return (
              <div key={`unit-${i}`} className="rounded-lg border border-line bg-card shadow-card">
                {/* 单元头:序号 + 知识点 + 排序/删除 */}
                <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-pill bg-primary text-[13px] font-bold text-card">{CIRCLED[i] ?? i + 1}</span>
                  <button
                    type="button"
                    onClick={() => { setKpKeyword(''); setKpIdx(i); }}
                    className="inline-flex items-center gap-1 text-[13.5px]"
                    aria-label={`单元 ${i + 1} 知识点`}
                  >
                    {u.kpNodeName
                      ? <Tag tone="primary">📘 {u.kpNodeName}</Tag>
                      : <span className="font-semibold text-red hover:underline">＋ 选择知识点</span>}
                  </button>
                  {warnings.length > 0 && <Tag tone="orange" className="ml-1">建议补全:{warnings.join(' · ')}</Tag>}
                  <div className="ml-auto flex items-center gap-1.5">
                    <button type="button" aria-label={`上移单元 ${i + 1}`} disabled={i === 0} onClick={() => moveUnit(i, -1)}
                      className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line text-[11px] text-ink-2 hover:border-primary hover:text-primary disabled:opacity-40">▲</button>
                    <button type="button" aria-label={`下移单元 ${i + 1}`} disabled={i === units.length - 1} onClick={() => moveUnit(i, 1)}
                      className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line text-[11px] text-ink-2 hover:border-primary hover:text-primary disabled:opacity-40">▼</button>
                    <button type="button" className="ml-1 text-[13px] font-medium text-red hover:underline"
                      onClick={() => update(units.filter((_, j) => j !== i).map((x, j) => ({ ...x, unitSeq: j + 1 })))}>删除单元</button>
                  </div>
                </div>
                {/* 三段槽 */}
                <div className="flex flex-col divide-y divide-dashed divide-line">
                  {(['lecture', 'practice', 'summary'] as UnitSlotType[]).map((slot) => (
                    <SlotRow
                      key={slot}
                      slot={slot}
                      unit={u}
                      resourceName={u.lecture.resourceId != null ? resourceById.get(u.lecture.resourceId)?.name : undefined}
                      paper={u.practice.paperId != null ? paperById.get(u.practice.paperId) : undefined}
                      onMount={() => setMount({ unitIdx: i, slot: slot === 'summary' ? 'practice' : slot })}
                      onDuration={(v) => patchSlot(i, slot, { durationMin: v })}
                      onToggleGuide={slot === 'practice' ? (v) => patchSlot(i, 'practice', { config: { ...u.practice.config, ai_guide: v } }) : undefined}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => update([...(units ?? []), newUnit((units?.length ?? 0) + 1)])}
            className="w-full rounded-lg border-[1.5px] border-dashed border-line bg-card py-3 text-[13.5px] font-semibold text-ink-2 hover:border-primary hover:text-primary"
          >
            + 添加知识点单元
          </button>
        </div>

        {/* 右:发布门槛 */}
        <div className="flex flex-col gap-3.5">
          <Card title={<span className="inline-flex items-center gap-2">编排说明 <AiChip /></span>}>
            <div className="text-[13px] leading-relaxed text-ink-2">
              每个知识点单元产出「讲解 / 随堂练 / 小结」三段,带同一知识点;上课时 AI 按单元顺序带学生逐段完成。三段建议齐全,缺失会提示但不强制保存。
            </div>
          </Card>
          <Card title="发布门槛">
            <div className="flex flex-col gap-2 text-[13px] leading-relaxed">
              <div className="text-ink-2">单元可自由增删、调序;发布无需三段全齐。</div>
              {pendingPaper.length === 0 ? (
                <div className="text-green">✅ 暂无待补项,本讲可随时发布</div>
              ) : (
                pendingPaper.map((k) => (
                  <div key={k} className="font-semibold text-red">❌ 有{CHECKLIST_LABEL[k]}需挂一份「已发布」试卷</div>
                ))
              )}
              <div className="mt-1.5 text-xs text-ink-3">仅随堂练 / 课后作业未挂已发布试卷会拦截发布{dirty && ';当前修改未保存,发布时会自动保存'}</div>
            </div>
          </Card>
        </div>
      </div>

      {/* 4201 缺失项 */}
      <Modal
        open={missing != null}
        title="备课检查未通过"
        onClose={() => setMissing(null)}
        footer={<Button onClick={() => setMissing(null)}>继续编排</Button>}
      >
        <div className="text-[13.5px] text-ink-2">以下环节还未就绪,补齐后才能发布课堂:</div>
        <div className="mt-3 flex flex-col gap-2">
          {(missing ?? []).map((m) => (
            <div key={m} className="rounded-md bg-red-soft px-3.5 py-2.5 text-[13.5px] font-semibold text-red">✕ {m}需挂一份已发布试卷</div>
          ))}
        </div>
      </Modal>

      {/* 挂载课件 / 选择试卷 */}
      <Modal
        open={mount != null}
        title={mountSlot === 'lecture' ? '挂载课件' : '选择随堂练试卷'}
        onClose={() => setMount(null)}
      >
        {mountItems.length === 0 ? (
          <EmptyState icon="▣" text={mountSlot === 'lecture' ? '资源库暂无课件' : '暂无可用随堂练试卷'} />
        ) : (
          <div className="flex flex-col gap-2">
            {mountItems.map((it) => {
              const selected = mountSelectedId === it.id;
              return (
                <button
                  key={it.id} type="button"
                  className={`flex items-center justify-between rounded-md border-[1.5px] px-3.5 py-2.5 text-left text-[13.5px] ${
                    selected ? 'border-primary bg-primary-soft font-bold text-primary' : 'border-line hover:border-ink-3'
                  }`}
                  onClick={() => {
                    if (mount == null) return;
                    if (mount === 'opening') patchOpening({ resourceId: it.id });
                    else if (mount.slot === 'lecture') patchSlot(mount.unitIdx, 'lecture', { resourceId: it.id });
                    else patchSlot(mount.unitIdx, 'practice', { paperId: it.id });
                    setMount(null);
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

      {/* 知识点选择 */}
      <Modal open={kpIdx != null} title="选择知识点" onClose={() => setKpIdx(null)}>
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
          onClick={() => { if (kpIdx != null) update(units.map((u, j) => (j === kpIdx ? { ...u, kpNodeId: null, kpNodeName: null } : u))); setKpIdx(null); }}
        >
          不选知识点(清除)
        </button>
        {kpNodes.length === 0 ? (
          <EmptyState icon="▦" text="暂无可选知识点" hint="教材知识图谱未加载或为空" />
        ) : (
          <div className="flex max-h-[46vh] flex-col gap-1.5 overflow-auto">
            {kpNodes
              .filter((n) => !kpKeyword.trim() || n.name.includes(kpKeyword.trim()))
              .map((n) => {
                const selected = kpIdx != null && units[kpIdx]?.kpNodeId === n.id;
                return (
                  <button
                    key={n.id} type="button"
                    className={`flex items-center justify-between rounded-md border-[1.5px] px-3.5 py-2.5 text-left text-[13.5px] ${
                      selected ? 'border-primary bg-primary-soft font-bold text-primary' : 'border-line hover:border-ink-3'
                    }`}
                    onClick={() => { if (kpIdx != null) update(units.map((u, j) => (j === kpIdx ? { ...u, kpNodeId: n.id, kpNodeName: n.name } : u))); setKpIdx(null); }}
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

/** 单元内一段内容槽行(讲解/随堂练/小结) */
function SlotRow({
  slot, unit, resourceName, paper, onMount, onDuration, onToggleGuide,
}: {
  slot: UnitSlotType;
  unit: KpUnit;
  resourceName?: string;
  paper?: PaperDto;
  onMount: () => void;
  onDuration: (v: number) => void;
  onToggleGuide?: (v: boolean) => void;
}) {
  const data = unit[slot];
  const missingPaper = slot === 'practice' && (unit.practice.paperId == null || paper?.status !== 'published');
  let desc: React.ReactNode;
  if (slot === 'lecture') {
    desc = resourceName
      ? <>《{resourceName}》</>
      : <span className="text-ink-3">未挂课件 —— 点右侧「挂载课件」</span>;
  } else if (slot === 'practice') {
    desc = paper
      ? <>《{paper.name}》 · {paper.questions.length} 题 · 共 {paper.totalScore} 分{paper.status !== 'published' && <span className="text-red"> · 未发布</span>}</>
      : <span className="text-ink-3">未挂题目/卷 —— 点右侧「选择试卷」</span>;
  } else {
    desc = <>AI 按每位学生本单元错题生成 2–4 道巩固题 <span className="rounded-[6px] bg-violet-soft px-1.5 py-px text-[11px] font-bold text-violet">AI</span></>;
  }
  return (
    <div className={`flex items-center gap-3.5 px-4 py-3 ${missingPaper ? 'bg-red-soft/30' : ''}`}>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[15px] ${SLOT_ICON[slot].cls}`}>{SLOT_ICON[slot].glyph}</div>
      <div className="min-w-0 flex-1">
        <b className="text-[13.5px]">{UNIT_SLOT_LABEL[slot]}</b>
        <div className="mt-0.5 truncate text-[12.5px] text-ink-2">{desc}</div>
        {slot === 'practice' && onToggleGuide && (
          <label className="mt-1 inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2">
            <input type="checkbox" checked={unit.practice.config.ai_guide !== false} onChange={(e) => onToggleGuide(e.target.checked)} aria-label="随堂练引导模式" />
            引导模式(只引导思路,不直接报答案)
          </label>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-ink-2">
        <input
          type="number" min={0} max={180}
          className="w-14 rounded-[8px] border-[1.5px] border-line px-2 py-1 text-center text-[13px] tabular-nums focus:border-primary focus:outline-none"
          value={data.durationMin}
          onChange={(e) => onDuration(Math.max(0, Number(e.target.value) || 0))}
          aria-label={`${UNIT_SLOT_LABEL[slot]}时长(分钟)`}
        />
        分钟
      </div>
      {slot !== 'summary' && (
        <button type="button" className={`${LINK_CLS} shrink-0`} onClick={onMount}>
          {slot === 'lecture' ? (resourceName ? '更换课件' : '挂载课件') : (paper ? '更换试卷' : '选择试卷')}
        </button>
      )}
    </div>
  );
}
