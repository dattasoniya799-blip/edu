/**
 * 独立组卷(试卷库内新建/编辑,不依附讲次)。
 * 痛点:此前唯一的组卷页绑死讲次(/lessons/:id/paper,建完即挂 homework 环节并发作业),
 *   试卷库的「新建/编辑」只能跳回讲次编排。本页直接建/改试卷:
 *   - 新建 /papers/new  → POST /papers(只建卷,不创建 assignment、不挂讲次)
 *   - 编辑 /papers/:id/edit → GET /papers/{id} 回填 → PUT /papers/{id}
 * 复用讲次版组卷的选题/分值核心:QuestionPicker(题库选题弹窗)+ SelectedQuestionList(分值表)
 *   + lib/paper(分值汇总/校验/PaperInput 变换)。被作业引用的卷 PUT → 4302,友好提示。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { PaperDto, PaperType, QuestionDto } from '@qiming/contracts';
import { Button, Card, Skeleton, useToast } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import { bizError } from '../lesson/lib/segments';
import { toPaperInput, toggleQuestion, totalScore, validatePaper, type PaperItem } from './lib/paper';
import { PAPER_TYPE_LABEL } from './lib/paperLibrary';
import { collectQuestionPages } from './lib/questionLibrary';
import { SelectedQuestionList } from './components/SelectedQuestionList';
import { QuestionPicker } from './components/QuestionPicker';

/** 独立卷可选类型(不依附环节,故三类都可选;顺序与试卷库页签一致) */
const TYPE_OPTIONS: PaperType[] = ['practice', 'homework', 'exam'];

export function PaperEditorPage() {
  const { id } = useParams();
  const paperId = id ? Number(id) : null;
  const isEdit = paperId != null;
  const navigate = useNavigate();
  const { toast } = useToast();

  const [questions, setQuestions] = useState<QuestionDto[]>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState<PaperType>('homework');
  const [items, setItems] = useState<PaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    const fetchQuestionPage = (page: number, size: number) =>
      api.get('/questions', { query: { page, size, status: 'published' } })
        .then((r) => ({ items: r.data.items as QuestionDto[], total: r.data.total }));
    Promise.all([
      collectQuestionPages(fetchQuestionPage),
      isEdit ? api.get('/papers/{id}', { params: { id: paperId } }) : Promise.resolve(null),
    ])
      .then(([qc, p]) => {
        setQuestions(qc.questions);
        if (qc.truncated) toast('题库题目较多,已载入前 1000 道用于组卷;可在选题弹窗搜索缩小范围');
        if (p) {
          const paper = p.data as PaperDto;
          setName(paper.name);
          setType(paper.type);
          setItems(paper.questions.map((pq) => ({ questionId: pq.questionId, score: pq.score })));
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
    // paperId 进入页面时确定;切换 new/edit 是不同路由,会重挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  const qById = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const total = totalScore(items);

  const patchScore = (questionId: number, score: number) =>
    setItems((prev) => prev.map((it) => (it.questionId === questionId ? { ...it, score } : it)));
  const remove = (questionId: number) => setItems((prev) => prev.filter((it) => it.questionId !== questionId));
  const toggle = (q: QuestionDto) => setItems((prev) => toggleQuestion(prev, q.id, q.type));

  const onSave = async () => {
    const errors = validatePaper(name, items, '试卷');
    if (errors.length) { toast(errors[0]); return; }
    setBusy(true);
    const input = toPaperInput(name, type, items);
    try {
      if (isEdit) {
        await api.put('/papers/{id}', { params: { id: paperId }, body: input });
        toast('试卷已保存');
      } else {
        await api.post('/papers', { body: input });
        toast('试卷已创建');
      }
      navigate('/papers');
    } catch (e) {
      const biz = bizError(e);
      toast(biz?.code === 4302 ? '该试卷已被作业引用,禁止修改(可在库内新建一份)' : e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div>
        <Skeleton className="mb-5 h-9 w-2/3" />
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
          <Skeleton lines={4} className="h-20 w-full" />
          <Skeleton lines={4} className="h-12 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHead
        title={(
          <span>
            <Link className="text-[15px] font-semibold text-primary hover:underline" to="/papers">← 试卷库</Link>
            <span className="text-ink-3"> / </span>{isEdit ? '编辑试卷' : '新建试卷'}
          </span>
        )}
        sub="从题库挑题组成一份独立试卷;保存后在试卷库集中复用,可后续挂到讲次或布置为作业"
        actions={(
          <>
            <Button onClick={() => setPickerOpen(true)}>+ 从题库选题</Button>
            <Button variant="primary" onClick={onSave} disabled={busy || loadError}>{isEdit ? '保存试卷' : '创建试卷'}</Button>
          </>
        )}
      />

      {loadError ? (
        <div className="rounded-lg border border-line bg-card px-5 py-8 text-center text-[13px] text-ink-2 shadow-card">
          试卷加载失败,可能是网络波动。
          <button type="button" className="ml-2 font-semibold text-primary hover:underline" onClick={() => navigate(0)}>重新加载</button>
        </div>
      ) : (
        <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
          {/* 左:已选题 + 分值 */}
          <Card
            title={<span>已选 {items.length} 题 · 当前总分 <span className="tabular-nums text-primary">{total}</span> 分</span>}
            extra={<button type="button" className="font-semibold text-primary hover:underline" onClick={() => setPickerOpen(true)}>去题库选题 →</button>}
            bodyClassName="p-0"
          >
            <SelectedQuestionList
              items={items}
              qById={qById}
              onScoreChange={patchScore}
              onRemove={remove}
              onPick={() => setPickerOpen(true)}
            />
          </Card>

          {/* 右:试卷信息 */}
          <Card title="试卷信息">
            <div className="flex flex-col gap-3.5 text-[13px]">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-ink-2">试卷名称</span>
                <input
                  className="rounded-[10px] border-[1.5px] border-line px-3 py-2 text-[13px] focus:border-primary focus:outline-none"
                  placeholder="如:第 4 讲随堂练 · 一次函数"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-ink-2">试卷类型</span>
                <select
                  className="rounded-[10px] border-[1.5px] border-line bg-card px-3 py-2 text-[13px]"
                  value={type}
                  onChange={(e) => setType(e.target.value as PaperType)}
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>{PAPER_TYPE_LABEL[t]}</option>
                  ))}
                </select>
              </label>
              <div className="rounded-md bg-bg px-3 py-2.5 text-xs leading-relaxed text-ink-3">
                独立组卷只建/改试卷本身,不创建作业、不挂讲次。要布置给学生,请到对应讲次「组卷」或作业流程引用本卷。
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* 题库选题弹窗(B3 题库同源数据:仅已入库题) */}
      <QuestionPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        questions={questions}
        items={items}
        onToggle={toggle}
      />
    </div>
  );
}
