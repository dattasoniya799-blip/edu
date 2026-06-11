/**
 * LaTeX 录题编辑器(原型 v0.4 id=t-editor)
 * 元信息栏(学段/学科/教材/章节/题型/难度 + 三维标签选择器)
 * 双栏:源码 textarea(工具条快捷插入)/ TexText 实时预览(公式语法错误红色提示由 TexText 内置)
 * 题干插图直传(/uploads/sts 两步流)· 题型联动(选项区 / 参考答案 + rubric 行编辑)
 * 保存草稿 / 提交入库(校验口径同 A3:rubric 解答题必填、≥1 教材知识点)
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { KpGraphDto, QuestionType } from '@qiming/contracts';
import { Button, EmptyState, Skeleton, TexText, useToast } from '@qiming/ui';
import { api } from '../../api';
import { TagPickerModal } from './components/TagPickerModal';
import { TEX_SNIPPETS, insertSnippet } from './lib/snippets';
import {
  DIFF_LABEL, TYPE_LABEL, emptyForm, formToInput, normalizeOptionLatex, questionToForm,
  type QuestionForm, type TagPick,
} from './lib/transform';
import { validateQuestion, type FieldError } from './lib/validate';
import { ACCEPT_FIGURE, checkFigureFile, uploadFigure } from './lib/upload';

const STAGES = ['初中', '高中'];
const SUBJECTS = ['数学', '物理', '化学', '语文', '英语'];
const VERSIONS = ['人教版', '北师大版'];

const EM_SELECT = 'rounded-[9px] border-[1.5px] border-line bg-card px-3 py-2 text-[13px] focus:border-primary focus:outline-none';
const TAG_TONE_BY_GRAPH = {
  curriculum_knowledge: 'bg-primary-soft text-primary',
  problem_solving_ability: 'bg-violet-soft text-violet',
  problem_solving_strategy: 'bg-orange-soft text-orange',
} as const;

function PaneHead({ color, children }: { color: 'primary' | 'green' | 'orange' | 'violet'; children: React.ReactNode }) {
  const dot = { primary: 'bg-primary', green: 'bg-green', orange: 'bg-orange', violet: 'bg-violet' }[color];
  return (
    <div className="flex items-center gap-2.5 border-b border-line bg-bg px-4 py-2.5 text-[12.5px] font-bold text-ink-2">
      <span className={`h-2 w-2 rounded-pill ${dot}`} />
      {children}
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
  const [graphs, setGraphs] = useState<KpGraphDto[]>([]);
  const [chapters, setChapters] = useState<string[]>([]);
  const [loading, setLoading] = useState(editId != null);
  const [notFound, setNotFound] = useState(false);
  const [tagModal, setTagModal] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const stemRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = (p: Partial<QuestionForm>) => setForm((f) => ({ ...f, ...p }));

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
      .then((r) => setForm(questionToForm(r.data)))
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

  const onPickFile = async (file: File) => {
    const bad = checkFigureFile(file);
    if (bad) { toast(bad); return; }
    setUploading(true);
    try {
      const ossKey = await uploadFigure(file);
      setForm((f) => ({
        ...f,
        figures: [...f.figures, {
          ossKey, position: f.figures.length + 1,
          previewUrl: URL.createObjectURL(file), fileName: file.name,
        }],
      }));
      toast('插图已上传并插入题干');
    } catch (e) {
      toast(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
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
      toast(mode === 'publish' ? '题目已提交入库,可在组卷时使用' : '草稿已保存,可在题库「草稿」中找到');
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

  const actions = (
    <>
      <Button disabled={saving} onClick={() => save('draft')}>保存草稿</Button>
      <Button variant="primary" disabled={saving} onClick={() => save('publish')}>{saving ? '提交中…' : '提交入库'}</Button>
    </>
  );

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
              if (file) void onPickFile(file);
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
          {form.figures.length > 0 && (
            <div className="mx-4 mb-4 flex flex-wrap gap-2.5">
              {form.figures.map((fig, i) => (
                <div key={fig.ossKey + i} className="flex flex-col items-center gap-1.5 rounded-[10px] border border-line bg-card p-2 text-[11px] text-ink-2">
                  {fig.previewUrl
                    ? <img src={fig.previewUrl} alt={fig.fileName ?? fig.ossKey} className="h-[84px] w-[120px] rounded-md object-contain" />
                    : <span className="flex h-[84px] w-[120px] items-center justify-center rounded-md bg-bg text-[20px] text-ink-3">⛶</span>}
                  <span className="max-w-[120px] truncate">{fig.fileName ?? fig.ossKey.split('/').pop()} · 已插入题干</span>
                  <button
                    type="button"
                    className="text-[12px] font-semibold text-red"
                    onClick={() => patch({ figures: form.figures.filter((_, j) => j !== i).map((x, j) => ({ ...x, position: j + 1 })) })}
                  >
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
            {form.stemLatex.trim() === '' && form.figures.length === 0
              ? <span className="text-[13px] text-ink-3">预览将在此显示…(公式语法错误会以红色提示)</span>
              : (
                <>
                  <TexText src={form.stemLatex} />
                  {form.figures.map((fig, i) => (
                    <div key={fig.ossKey + i} className="mt-3">
                      {fig.previewUrl
                        ? <img src={fig.previewUrl} alt={`图 ${i + 1}`} className="max-h-[180px] rounded-md border border-line" />
                        : <span className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary-soft px-2 py-1 text-xs text-primary">⛶ 图 {i + 1} · {fig.ossKey}</span>}
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
              </div>
            ))}
            <FieldErrors errors={errors} field="options" />
          </div>
        ) : (
          <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-card shadow-card">
            <PaneHead color="orange">参考答案{form.type === 'solution' && '与评分要点'} · AI 预批将按要点逐步给分</PaneHead>
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
          <PaneHead color="violet">解析(学生答错后可见,同样支持 LaTeX)</PaneHead>
          <textarea
            value={form.analysisLatex}
            onChange={(e) => patch({ analysisLatex: e.target.value })}
            spellCheck={false}
            aria-label="解析源码"
            placeholder="如:设 $y=kx+b$,把两点代入得 …"
            className="min-h-[110px] flex-1 resize-y bg-card p-4 font-mono text-[13px] leading-[1.8] focus:bg-bg/50 focus:outline-none"
          />
          <div className="min-h-[80px] border-t border-line px-4 py-3 text-sm leading-[1.9]">
            {form.analysisLatex.trim() === ''
              ? <span className="text-[13px] text-ink-3">解析预览…</span>
              : <TexText src={form.analysisLatex} />}
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
        value={form.tags}
        onClose={() => setTagModal(false)}
        onConfirm={(tags: TagPick[]) => { patch({ tags }); setTagModal(false); }}
      />
    </div>
  );
}
