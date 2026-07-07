/**
 * LaTeX 录题编辑器(原型 v0.4 id=t-editor)
 * 元信息栏(学段/学科/教材/章节/题型/难度 + 三维标签选择器)
 * 双栏:源码 textarea(工具条快捷插入)/ TexText 实时预览(公式语法错误红色提示由 TexText 内置)
 * 题干插图直传(/uploads/sts 两步流)· 题型联动(选项区 / 参考答案 + rubric 行编辑)
 * 保存草稿 / 提交入库(校验口径同 A3:rubric 解答题必填、≥1 教材知识点)
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { KpGraphDto, QuestionDto, QuestionType } from '@qiming/contracts';
import { Button, EmptyState, OssImage, Skeleton, TexText, useToast } from '@qiming/ui';
import { api, resolveFigureSrc } from '../../api';
import { TagPickerModal } from './components/TagPickerModal';
import { TEX_SNIPPETS, insertSnippet } from './lib/snippets';
import {
  DIFF_LABEL, SUBJECTS, TYPE_LABEL, canPublishQuestion, emptyForm, formToInput, normalizeOptionLatex, questionToForm,
  type FigureAnchor, type FigureItem, type QuestionForm, type TagPick,
} from './lib/transform';
import { validateQuestion, type FieldError } from './lib/validate';
import { ACCEPT_FIGURE, checkFigureFile, uploadFigure } from './lib/upload';

const STAGES = ['初中', '高中'];
const VERSIONS = ['人教版', '北师大版'];

const EM_SELECT = 'rounded-[9px] border-[1.5px] border-line bg-card px-3 py-2 text-[13px] focus:border-primary focus:outline-none';
const ANCHOR_LABEL: Record<FigureAnchor['target'], string> = {
  stem: '题干', option: '选项', analysis: '解析', reference: '参考答案', rubric: '评分要点',
};
const TAG_TONE_BY_GRAPH = {
  curriculum_knowledge: 'bg-primary-soft text-primary',
  problem_solving_ability: 'bg-violet-soft text-violet',
  problem_solving_strategy: 'bg-orange-soft text-orange',
} as const;

// C2 #7:三种解析录入(写 analysisBriefLatex/analysisLatex/analysisDetailLatex)
type AnalysisKey = 'analysisBriefLatex' | 'analysisLatex' | 'analysisDetailLatex';
const ANALYSIS_TABS: { key: AnalysisKey; label: string }[] = [
  { key: 'analysisBriefLatex', label: '简单解析' },
  { key: 'analysisLatex', label: '正常解析' },
  { key: 'analysisDetailLatex', label: '详细解析' },
];
const ANALYSIS_LABEL: Record<AnalysisKey, string> = {
  analysisBriefLatex: '简单解析', analysisLatex: '正常解析', analysisDetailLatex: '详细解析',
};
const ANALYSIS_PLACEHOLDER: Record<AnalysisKey, string> = {
  analysisBriefLatex: '一句话点出关键步骤,如:**上加下减**,改 $b$ 即可。',
  analysisLatex: '常规解析,如:设 $y=kx+b$,把两点代入得 …',
  analysisDetailLatex: '逐步详解,可用列表:\n1. 设 $y=kx+b$\n2. 代入两点求 $k,b$\n3. 还原平移方向',
};

// 方案 A(2026-06-13 批准):figures[] 带 anchor,选项/解析/参考答案/评分要点均可插图。
// 录题时各位置走与题干同款两步直传(/uploads/sts → PUT),成功后写入 figures(带 anchor)。

/** 某锚点(target+ref)下属于本控件的插图 */
function figuresOfAnchor(figures: FigureItem[], target: FigureAnchor['target'], anchorRef?: string): FigureItem[] {
  return figures.filter((f) => (f.anchor?.target ?? 'stem') === target && (f.anchor?.ref ?? undefined) === (anchorRef ?? undefined));
}

/**
 * 插图锚点控件:小号「⛶ 插图」按钮 + 已挂缩略图 + 删除。
 * 点击走两步直传(由父级 onUpload 实现),成功后把 {ossKey, position, anchor} 写入 figures。
 */
function FigureAnchorControl({
  label, target, anchorRef, figures, uploading, onUpload, onRemove,
}: {
  label: string;
  target: FigureAnchor['target'];
  anchorRef?: string;
  figures: FigureItem[];
  uploading: boolean;
  onUpload: (file: File, anchor: FigureAnchor) => void;
  onRemove: (fig: FigureItem) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mine = figuresOfAnchor(figures, target, anchorRef);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_FIGURE}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file, anchorRef != null ? { target, ref: anchorRef } : { target });
          e.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1 rounded-[7px] border border-dashed border-line px-2 py-1 text-[11.5px] text-ink-3 transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
      >
        ⛶ {uploading ? '上传中…' : mine.length > 0 ? `${label}(${mine.length})` : label}
      </button>
      {mine.map((fig, i) => (
        <span key={fig.ossKey + i} className="inline-flex items-center gap-1 rounded-[7px] border border-line bg-card px-1.5 py-0.5 text-[11px] text-ink-2">
          <OssImage
            ossKey={fig.previewUrl ?? fig.ossKey}
            alt={`${label}缩略图`}
            resolveSrc={resolveFigureSrc}
            className="h-6 w-9 rounded object-contain"
            boxClassName="h-6 w-9"
            compact
          />
          <button type="button" aria-label={`删除${label}`} className="font-semibold text-red" onClick={() => onRemove(fig)}>✕</button>
        </span>
      ))}
    </span>
  );
}

function PaneHead({ color, children, action }: { color: 'primary' | 'green' | 'orange' | 'violet'; children: React.ReactNode; action?: React.ReactNode }) {
  const dot = { primary: 'bg-primary', green: 'bg-green', orange: 'bg-orange', violet: 'bg-violet' }[color];
  return (
    <div className="flex items-center gap-2.5 border-b border-line bg-bg px-4 py-2.5 text-[12.5px] font-bold text-ink-2">
      <span className={`h-2 w-2 rounded-pill ${dot}`} />
      {children}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}

function FieldErrors({ errors, field }: { errors: FieldError[]; field: string }) {
  const list = errors.filter((e) => e.field === field);
  if (list.length === 0) return null;
  return (
    <div className="px-4 pb-2 text-xs font-medium text-red">
      {list.map((e, i) => <div key={i}>{e.message}</div>)}
    </div>
  );
}

export function EditorPage() {
  const { id } = useParams();
  const editId = id != null ? Number(id) : null;
  const navigate = useNavigate();
  const { toast } = useToast();

  const [form, setForm] = useState<QuestionForm>(emptyForm);
  const [status, setStatus] = useState<QuestionDto['status'] | null>(null);
  const [graphs, setGraphs] = useState<KpGraphDto[]>([]);
  const [chapters, setChapters] = useState<string[]>([]);
  const [loading, setLoading] = useState(editId != null);
  const [notFound, setNotFound] = useState(false);
  const [tagModal, setTagModal] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [analysisTab, setAnalysisTab] = useState<AnalysisKey>('analysisLatex');
  const stemRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // P2-11:跟踪本组件创建的预览 objectURL,换图/删除及卸载时释放,防内存泄漏
  const previewUrls = useRef<Set<string>>(new Set());

  // 卸载时释放所有未回收的预览 objectURL
  useEffect(() => () => {
    previewUrls.current.forEach((u) => URL.revokeObjectURL(u));
    previewUrls.current.clear();
  }, []);

  const patch = (p: Partial<QuestionForm>) => setForm((f) => ({ ...f, ...p }));
  // 已入库题不可再 publish(后端 400):只显示"保存修改";新题/草稿 → 可入库
  const allowPublish = canPublishQuestion(editId == null ? null : status);

  useEffect(() => {
    api.get('/kp/graphs').then(async (r) => {
      setGraphs(r.data);
      const curriculum = r.data.find((g) => g.graphType === 'curriculum_knowledge');
      if (curriculum) {
        const nodes = await api.get('/kp/nodes', { query: { graphId: curriculum.id } });
        setChapters([...new Set(nodes.data.map((n) => n.chapter).filter((c): c is string => !!c))]);
      }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (editId == null) return;
    setLoading(true);
    api.get('/questions/{id}', { params: { id: editId } })
      .then((r) => { setForm(questionToForm(r.data)); setStatus(r.data.status); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [editId]);

  const insert = (tex: string) => {
    const el = stemRef.current;
    const start = el?.selectionStart ?? form.stemLatex.length;
    const end = el?.selectionEnd ?? form.stemLatex.length;
    const { text, caret } = insertSnippet(form.stemLatex, start, end, tex);
    patch({ stemLatex: text });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  /** 两步直传 → 把 {ossKey, position, anchor} 写入 figures(题干/选项/解析/参考答案/评分要点) */
  const uploadToAnchor = async (file: File, anchor: FigureAnchor) => {
    const bad = checkFigureFile(file);
    if (bad) { toast(bad); return; }
    setUploading(true);
    try {
      const ossKey = await uploadFigure(file);
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      setForm((f) => ({
        ...f,
        figures: [...f.figures, {
          ossKey, position: f.figures.length + 1, anchor,
          previewUrl, fileName: file.name,
        }],
      }));
      toast(`插图已上传 · ${ANCHOR_LABEL[anchor.target]}${anchor.ref ? ` ${anchor.ref}` : ''}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };
  const removeFigure = (fig: FigureItem) => {
    // 释放该图的预览 objectURL(若由本组件创建)
    if (fig.previewUrl && previewUrls.current.has(fig.previewUrl)) {
      URL.revokeObjectURL(fig.previewUrl);
      previewUrls.current.delete(fig.previewUrl);
    }
    setForm((f) => ({ ...f, figures: f.figures.filter((x) => x !== fig).map((x, j) => ({ ...x, position: j + 1 })) }));
  };

  const toggleCorrect = (label: string) => {
    setForm((f) => ({
      ...f,
      options: f.options.map((o) => (
        f.type === 'single'
          ? { ...o, isCorrect: o.label === label }
          : o.label === label ? { ...o, isCorrect: !o.isCorrect } : o
      )),
    }));
  };

  const save = async (mode: 'draft' | 'publish') => {
    const errs = validateQuestion(form, mode);
    setErrors(errs);
    if (errs.length > 0) { toast(errs[0].message); return; }
    setSaving(true);
    try {
      const body = formToInput(form);
      let qid = editId;
      if (editId == null) {
        const r = await api.post('/questions', { body });
        qid = r.data.id;
      } else {
        await api.put('/questions/{id}', { params: { id: editId }, body });
      }
      if (mode === 'publish' && qid != null) await api.post('/questions/{id}/publish', { params: { id: qid } });
      toast(
        mode === 'publish' ? '题目已提交入库,可在组卷时使用'
        : allowPublish ? '草稿已保存,可在题库「草稿」中找到'
        : '修改已保存', // 已入库题:只做 PUT 更新,保持入库态
      );
      navigate('/bank');
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (notFound) {
    return (
      <EmptyState
        text="题目不存在或已被删除"
        action={<Button onClick={() => navigate('/bank')}>← 返回题库</Button>}
      />
    );
  }
  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton lines={2} className="h-60 w-full" /></div>;
  }

  const actions = allowPublish ? (
    <>
      <Button disabled={saving} onClick={() => save('draft')}>保存草稿</Button>
      <Button variant="primary" disabled={saving} onClick={() => save('publish')}>{saving ? '提交中…' : '提交入库'}</Button>
    </>
  ) : (
    // 已入库题:只允许保存修改(PUT),不再调 publish(否则后端 400)
    <>
      <span className="inline-flex items-center gap-1 self-center rounded-md bg-green-soft px-2.5 py-1 text-[12.5px] font-bold text-green">✓ 已入库</span>
      <Button variant="primary" disabled={saving} onClick={() => save('draft')}>{saving ? '保存中…' : '保存修改'}</Button>
    </>
  );

  const stemFigures = figuresOfAnchor(form.figures, 'stem');

  return (
    <div>
      {/* 页头(同 page-head;标题含返回链接,不复用 PageHead 的纯文本 title) */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[21px] font-extrabold">
            <Link to="/bank" className="text-[15px] font-semibold text-primary">← 题库</Link>
            <span className="mx-2 text-ink-3">/</span>
            {editId == null ? '录入新题' : `编辑题目 #${editId}`}
          </h2>
          <div className="mt-1 text-[13px] text-ink-2">
            左侧输入题干源码(支持 LaTeX 公式,$...$ 行内、$$...$$ 独立成行、\ce{'{}'} 化学式),右侧实时预览
          </div>
        </div>
        <div className="flex gap-2.5">{actions}</div>
      </div>

      {/* 元信息栏(editor-meta) */}
      <div className="mb-3.5 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-card px-5 py-4 shadow-card">
        {([
          ['学段', form.stage, STAGES, (v: string) => patch({ stage: v })],
          ['学科', form.subject, SUBJECTS, (v: string) => patch({ subject: v })],
          ['教材版本', form.textbookVersion, VERSIONS, (v: string) => patch({ textbookVersion: v })],
        ] as const).map(([label, value, opts, onChange]) => (
          <label key={label} className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-semibold text-ink-2">{label}</span>
            <select className={EM_SELECT} value={value} onChange={(e) => onChange(e.target.value)}>
              {[...new Set([value, ...opts])].filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-semibold text-ink-2">章节</span>
          <select className={EM_SELECT} value={form.chapter} onChange={(e) => patch({ chapter: e.target.value })}>
            {[...new Set([form.chapter, ...chapters])].filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div className="flex min-w-[260px] flex-1 flex-col gap-1.5">
          <span className="text-[11.5px] font-semibold text-ink-2">三维标注(知识点 / 能力 / 策略,用于学情归因)</span>
          <div className="flex min-h-[37px] flex-wrap items-center gap-1.5 rounded-[9px] border-[1.5px] border-line px-2 py-1">
            {form.tags.map((t) => (
              <span key={t.nodeId} className={`inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-xs font-semibold ${TAG_TONE_BY_GRAPH[t.graphType]}`}>
                {t.name}
                <button
                  type="button"
                  aria-label={`移除 ${t.name}`}
                  className="opacity-60 hover:opacity-100"
                  onClick={() => patch({ tags: form.tags.filter((x) => x.nodeId !== t.nodeId) })}
                >
                  ✕
                </button>
              </span>
            ))}
            <button type="button" className="px-1 text-[12.5px] font-semibold text-primary" onClick={() => setTagModal(true)}>
              ＋ 选择节点…
            </button>
          </div>
          {errors.some((e) => e.field === 'tags') && (
            <div className="text-xs font-medium text-red">{errors.find((e) => e.field === 'tags')!.message}</div>
          )}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-semibold text-ink-2">题型</span>
          <select className={EM_SELECT} value={form.type} onChange={(e) => patch({ type: e.target.value as QuestionType })}>
            {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-semibold text-ink-2">难度</span>
          <select className={EM_SELECT} value={form.difficulty} onChange={(e) => patch({ difficulty: Number(e.target.value) })}>
            {[1, 2, 3].map((d) => <option key={d} value={d}>{DIFF_LABEL[d]}</option>)}
          </select>
        </label>
      </div>

      {/* 双栏:源码 / 预览 */}
      <div className="mb-3.5 grid grid-cols-2 gap-3.5">
        <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-card shadow-card">
          <PaneHead color="primary">题干源码 · LaTeX</PaneHead>
          <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
            {TEX_SNIPPETS.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => insert(s.tex)}
                className="rounded-[7px] border border-line px-2.5 py-1 font-mono text-xs text-ink-2 transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
              >
                {s.label}
              </button>
            ))}
          </div>
          <textarea
            ref={stemRef}
            value={form.stemLatex}
            onChange={(e) => patch({ stemLatex: e.target.value })}
            spellCheck={false}
            aria-label="题干源码"
            placeholder="在此输入题干源码…"
            className="min-h-[190px] flex-1 resize-y bg-card p-4 font-mono text-[13px] leading-[1.8] text-ink focus:bg-bg/50 focus:outline-none"
          />
          <FieldErrors errors={errors} field="stemLatex" />
          {/* 题干插图直传(/uploads/sts 两步流) */}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT_FIGURE}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadToAnchor(file, { target: 'stem' });
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="mx-4 mb-4 flex items-center gap-3.5 rounded-md border-2 border-dashed border-line p-3.5 text-left transition-colors hover:border-primary disabled:opacity-60"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-primary-soft text-xl text-primary">⛶</span>
            <span className="text-[13px] text-ink-2">
              {uploading ? '上传中…' : '点击上传题干插图'}
              <small className="block text-[11.5px] text-ink-3">支持函数图象、几何图形、实验装置图等 · png / jpg / svg ≤ 2MB</small>
            </span>
          </button>
          {stemFigures.length > 0 && (
            <div className="mx-4 mb-4 flex flex-wrap gap-2.5">
              {stemFigures.map((fig, i) => (
                <div key={fig.ossKey + i} className="flex flex-col items-center gap-1.5 rounded-[10px] border border-line bg-card p-2 text-[11px] text-ink-2">
                  <OssImage
                    ossKey={fig.previewUrl ?? fig.ossKey}
                    alt={fig.fileName ?? fig.ossKey}
                    resolveSrc={resolveFigureSrc}
                    className="h-[84px] w-[120px] rounded-md object-contain"
                    boxClassName="h-[84px] w-[120px]"
                  />
                  <span className="max-w-[120px] truncate">{fig.fileName ?? fig.ossKey.split('/').pop()} · 已插入题干</span>
                  <button type="button" className="text-[12px] font-semibold text-red" onClick={() => removeFigure(fig)}>
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-card shadow-card">
          <PaneHead color="green">实时预览 · 学生端呈现效果</PaneHead>
          <div className="min-h-[190px] flex-1 p-5 text-[15px] leading-[2]">
            {form.stemLatex.trim() === '' && stemFigures.length === 0
              ? <span className="text-[13px] text-ink-3">预览将在此显示…(公式语法错误会以红色提示)</span>
              : (
                <>
                  <TexText src={form.stemLatex} />
                  {stemFigures.map((fig, i) => (
                    <div key={fig.ossKey + i} className="mt-3">
                      <OssImage
                        ossKey={fig.previewUrl ?? fig.ossKey}
                        alt={`图 ${i + 1}`}
                        resolveSrc={resolveFigureSrc}
                        className="max-h-[180px] rounded-md border border-line"
                      />
                    </div>
                  ))}
                </>
              )}
          </div>
        </div>
      </div>

      {/* 题型联动:选项区 / 参考答案 + 评分要点;解析 */}
      <div className="mb-3.5 grid grid-cols-2 gap-3.5">
        {(form.type === 'single' || form.type === 'multi') ? (
          <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-card shadow-card">
            <PaneHead color="orange">
              选项({TYPE_LABEL[form.type]}) · 点圆圈设为正确答案{form.type === 'multi' && '(可多选)'}
            </PaneHead>
            {form.options.map((o) => (
              <div key={o.label} className="flex items-center gap-2.5 border-b border-dashed border-line px-4 py-2.5 last:border-none">
                <button
                  type="button"
                  aria-label={`设 ${o.label} 为正确答案`}
                  onClick={() => toggleCorrect(o.label)}
                  className={`relative h-5 w-5 shrink-0 rounded-pill border-2 ${o.isCorrect ? 'border-green' : 'border-line'}`}
                >
                  {o.isCorrect && <span className="absolute inset-[3px] rounded-pill bg-green" />}
                </button>
                <span className="w-5 font-extrabold text-ink-2">{o.label}</span>
                <input
                  value={o.contentLatex}
                  aria-label={`选项 ${o.label} 源码`}
                  onChange={(e) => patch({ options: form.options.map((x) => (x.label === o.label ? { ...x, contentLatex: e.target.value } : x)) })}
                  placeholder="选项内容(裸 LaTeX 自动按公式渲染)"
                  className="min-w-0 flex-1 rounded-[9px] border-[1.5px] border-line px-3 py-2 font-mono text-[12.5px] focus:border-primary focus:outline-none"
                />
                <span className="min-w-0 flex-1 px-1.5 text-sm">
                  {o.contentLatex.trim() !== '' && <TexText src={normalizeOptionLatex(o.contentLatex)} />}
                </span>
                <FigureAnchorControl
                  label="插图" target="option" anchorRef={o.label}
                  figures={form.figures} uploading={uploading} onUpload={uploadToAnchor} onRemove={removeFigure}
                />
              </div>
            ))}
            <FieldErrors errors={errors} field="options" />
          </div>
        ) : (
          <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-card shadow-card">
            <PaneHead color="orange" action={(
              <FigureAnchorControl
                label="插图" target="reference"
                figures={form.figures} uploading={uploading} onUpload={uploadToAnchor} onRemove={removeFigure}
              />
            )}>参考答案{form.type === 'solution' && '与评分要点'} · AI 预批将按要点逐步给分</PaneHead>
            {form.type === 'blank' ? (
              <div className="flex flex-col gap-2 p-4">
                {form.blankAnswers.map((t, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span className="text-xs text-ink-3">第 {i + 1} 空</span>
                    <input
                      value={t}
                      aria-label={`第 ${i + 1} 空参考答案`}
                      onChange={(e) => patch({ blankAnswers: form.blankAnswers.map((x, j) => (j === i ? e.target.value : x)) })}
                      placeholder="参考答案(支持 $..$ 公式)"
                      className="min-w-0 flex-1 rounded-[9px] border-[1.5px] border-line px-3 py-2 font-mono text-[12.5px] focus:border-primary focus:outline-none"
                    />
                    <span className="min-w-0 flex-1 text-sm">{t.trim() !== '' && <TexText src={normalizeOptionLatex(t)} />}</span>
                    {form.blankAnswers.length > 1 && (
                      <button type="button" className="text-[12px] font-semibold text-red" onClick={() => patch({ blankAnswers: form.blankAnswers.filter((_, j) => j !== i) })}>删除</button>
                    )}
                  </div>
                ))}
                <button type="button" className="self-start text-[12.5px] font-semibold text-primary" onClick={() => patch({ blankAnswers: [...form.blankAnswers, ''] })}>
                  ＋ 添加一空
                </button>
              </div>
            ) : (
              <>
                <textarea
                  value={form.referenceLatex}
                  onChange={(e) => patch({ referenceLatex: e.target.value })}
                  spellCheck={false}
                  aria-label="参考答案源码"
                  placeholder="【参考答案】支持 LaTeX,如:设 $y=kx+b$,代入两点解得 …"
                  className="min-h-[110px] resize-y border-b border-line bg-card p-4 font-mono text-[13px] leading-[1.8] focus:bg-bg/50 focus:outline-none"
                />
                {form.referenceLatex.trim() !== '' && (
                  <div className="border-b border-line px-4 py-3 text-sm leading-[1.9]"><TexText src={form.referenceLatex} /></div>
                )}
                {/* rubric 结构化行编辑:步骤 / 描述 / 分值 */}
                <div className="flex flex-col gap-2 p-4">
                  <div className="flex items-center justify-between text-[12.5px] font-bold text-ink-2">
                    评分要点(rubric)
                    <span className="text-xs font-medium tabular-nums text-ink-3">
                      合计 {form.rubric.reduce((s, r) => s + (r.score || 0), 0)} 分
                    </span>
                  </div>
                  {form.rubric.length === 0 && <div className="text-xs text-ink-3">解答题必填:AI 预批与教师复核都按要点逐步给分</div>}
                  {form.rubric.map((r, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <span className="w-12 shrink-0 text-xs tabular-nums text-ink-3">步骤 {i + 1}</span>
                      <input
                        value={r.desc}
                        aria-label={`步骤 ${i + 1} 描述`}
                        onChange={(e) => patch({ rubric: form.rubric.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)) })}
                        placeholder="如:设式并代入两点"
                        className="min-w-0 flex-1 rounded-[9px] border-[1.5px] border-line px-3 py-2 text-[12.5px] focus:border-primary focus:outline-none"
                      />
                      <input
                        type="number"
                        min={1}
                        value={r.score || ''}
                        aria-label={`步骤 ${i + 1} 分值`}
                        onChange={(e) => patch({ rubric: form.rubric.map((x, j) => (j === i ? { ...x, score: Number(e.target.value) } : x)) })}
                        className="w-16 rounded-[9px] border-[1.5px] border-line px-2 py-2 text-[12.5px] tabular-nums focus:border-primary focus:outline-none"
                      />
                      <span className="text-xs text-ink-3">分</span>
                      <FigureAnchorControl
                        label="插图" target="rubric" anchorRef={String(r.step)}
                        figures={form.figures} uploading={uploading} onUpload={uploadToAnchor} onRemove={removeFigure}
                      />
                      <button
                        type="button"
                        className="text-[12px] font-semibold text-red"
                        onClick={() => patch({ rubric: form.rubric.filter((_, j) => j !== i).map((x, j) => ({ ...x, step: j + 1 })) })}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="self-start text-[12.5px] font-semibold text-primary"
                    onClick={() => patch({ rubric: [...form.rubric, { step: form.rubric.length + 1, desc: '', score: 3 }] })}
                  >
                    ＋ 添加评分要点
                  </button>
                </div>
              </>
            )}
            <FieldErrors errors={errors} field="answer" />
            <FieldErrors errors={errors} field="rubric" />
          </div>
        )}

        <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-card shadow-card">
          <PaneHead color="violet" action={(
            <FigureAnchorControl
              label="插图" target="analysis"
              figures={form.figures} uploading={uploading} onUpload={uploadToAnchor} onRemove={removeFigure}
            />
          )}>解析(学生答错后可见;简单 / 正常 / 详细 三档,均可空,标准 Markdown + LaTeX)</PaneHead>
          {/* C2 #7:三种解析分区录入,各自实时预览 */}
          <div className="flex gap-1.5 border-b border-line px-3 py-2">
            {ANALYSIS_TABS.map((t) => {
              const on = analysisTab === t.key;
              const filled = form[t.key].trim() !== '';
              return (
                <button
                  key={t.key} type="button" onClick={() => setAnalysisTab(t.key)}
                  className={`rounded-[8px] border-[1.5px] px-3 py-1 text-[12.5px] font-semibold transition-colors ${
                    on ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink-2 hover:border-ink-3'
                  }`}
                >
                  {t.label}{filled && <span className="ml-1 text-green" aria-label="已填写">●</span>}
                </button>
              );
            })}
          </div>
          <textarea
            value={form[analysisTab]}
            onChange={(e) => patch({ [analysisTab]: e.target.value } as Partial<QuestionForm>)}
            spellCheck={false}
            aria-label={`${ANALYSIS_LABEL[analysisTab]}源码`}
            placeholder={ANALYSIS_PLACEHOLDER[analysisTab]}
            className="min-h-[110px] flex-1 resize-y bg-card p-4 font-mono text-[13px] leading-[1.8] focus:bg-bg/50 focus:outline-none"
          />
          <div className="min-h-[80px] border-t border-line px-4 py-3 text-sm leading-[1.9]">
            <div className="mb-1 text-[11.5px] font-semibold text-ink-3">{ANALYSIS_LABEL[analysisTab]} · 预览</div>
            {form[analysisTab].trim() === ''
              ? <span className="text-[13px] text-ink-3">该档解析为空(可不填,展示侧会自动隐藏)</span>
              : <TexText src={form[analysisTab]} />}
          </div>
        </div>
      </div>

      {/* 底部动作条(ed-actions) */}
      <div className="flex items-center justify-between rounded-lg border border-line bg-card px-5 py-3.5 shadow-card">
        <div className="text-[12.5px] text-ink-3">
          {errors.length > 0
            ? <span className="font-medium text-red">还有 {errors.length} 项未通过校验,请按红色提示修改</span>
            : '入库后题目可在组卷时使用;保存草稿可稍后在题库「草稿」中继续编辑'}
        </div>
        <div className="flex gap-2.5">{actions}</div>
      </div>

      <TagPickerModal
        open={tagModal}
        graphs={graphs}
        subject={form.subject}
        value={form.tags}
        onClose={() => setTagModal(false)}
        onConfirm={(tags: TagPick[]) => { patch({ tags }); setTagModal(false); }}
      />
    </div>
  );
}
