/**
 * 课后作业组卷(原型 v0.4 id=t-paper)
 * 已选题列表(分值编辑 + 实时总分)+ 发布设置(名称/截止时间;恒发本课程全体)+ 题库选题弹窗(与 B3 题库同口径数据)
 * 发布作业 = 保存试卷(POST/PUT /papers)→ POST /assignments → 挂载到讲次 homework 环节
 * 裁剪口径(MVP 手册 1.1):AI 组卷建议、定时发布延后;截止时间保留
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { LessonDto, LessonSegmentDto, PaperDto, QuestionDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Skeleton, Tag, useToast } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import { bizError, newSegment, reseq } from '../lesson/lib/segments';
import { fmtDateTime } from '../course/lib/format';
import { defaultScore, toPaperInput, totalScore, validatePaper, type PaperItem } from './lib/paper';
import { collectQuestionPages } from './lib/questionLibrary';
import { SelectedQuestionList } from './components/SelectedQuestionList';
import { QuestionPicker } from './components/QuestionPicker';

/** 截止时间默认值 = 明天 21:00(本地时区,datetime-local 形状 YYYY-MM-DDTHH:mm) */
function defaultDueAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T21:00`;
}

export function PaperBuilderPage() {
  const { id } = useParams();
  const lessonId = Number(id);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [lesson, setLesson] = useState<LessonDto | null>(null);
  const [questions, setQuestions] = useState<QuestionDto[]>([]);
  const [paperId, setPaperId] = useState<number | null>(Number(searchParams.get('paperId')) || null);
  const [name, setName] = useState('');
  const [items, setItems] = useState<PaperItem[]>([]);
  const [dueAt, setDueAt] = useState(defaultDueAt);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    const initialPaperId = Number(searchParams.get('paperId')) || null;
    const fetchQuestionPage = (page: number, size: number) =>
      api.get('/questions', { query: { page, size, status: 'published' } })
        .then((r) => ({ items: r.data.items as QuestionDto[], total: r.data.total }));
    Promise.all([
      api.get('/lessons/{id}', { params: { id: lessonId } }),
      collectQuestionPages(fetchQuestionPage),
      initialPaperId ? api.get('/papers/{id}', { params: { id: initialPaperId } }) : Promise.resolve(null),
    ])
      .then(([l, qc, p]) => {
        const lessonData = l.data as LessonDto;
        setLesson(lessonData);
        setQuestions(qc.questions);
        if (qc.truncated) toast('题库题目较多,已载入前 1000 道用于组卷;可在选题弹窗搜索缩小范围');
        if (p) {
          const paper = p.data as PaperDto;
          setName(paper.name);
          setItems(paper.questions.map((pq) => ({ questionId: pq.questionId, score: pq.score })));
        } else {
          setName(`${lessonData.title.replace(' · ', '课后作业 · ')}`);
        }
      })
      .finally(() => setLoading(false));
    // searchParams 仅取初始值(进入页面时确定要编辑的卷)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  const qById = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const total = totalScore(items);

  const patchScore = (questionId: number, score: number) =>
    setItems((prev) => prev.map((it) => (it.questionId === questionId ? { ...it, score } : it)));
  const remove = (questionId: number) => setItems((prev) => prev.filter((it) => it.questionId !== questionId));
  const add = (q: QuestionDto) => setItems((prev) =>
    prev.some((it) => it.questionId === q.id) ? prev : [...prev, { questionId: q.id, score: defaultScore(q.type) }]);

  /** 保存试卷(创建即 published,A4 口径)+ 挂载到讲次 homework 环节;返回 paperId */
  const savePaper = async (): Promise<number | null> => {
    const errors = validatePaper(name, items);
    if (errors.length) { toast(errors[0]); return null; }
    const input = toPaperInput(name, 'homework', items);
    try {
      let pid = paperId;
      if (pid) {
        await api.put('/papers/{id}', { params: { id: pid }, body: input });
      } else {
        const created = await api.post('/papers', { body: input });
        pid = (created.data as PaperDto).id;
        setPaperId(pid);
      }
      // 挂载:homework 环节 paperId 指向本卷(无 homework 环节则追加一个)
      const segResp = await api.get('/lessons/{id}/segments', { params: { id: lessonId } });
      const segs = segResp.data as LessonSegmentDto[];
      const next = segs.some((s) => s.type === 'homework')
        ? segs.map((s) => (s.type === 'homework' ? { ...s, paperId: pid } : s))
        : [...segs, { ...newSegment('homework', segs.length + 1), paperId: pid }];
      await api.put('/lessons/{id}/segments', { params: { id: lessonId }, body: reseq(next) });
      return pid;
    } catch (e) {
      const biz = bizError(e);
      toast(biz?.code === 4302 ? '该试卷已被作业引用,禁止修改(可新建一份)' : e instanceof Error ? e.message : '保存失败');
      return null;
    }
  };

  const onSave = async () => {
    setBusy(true);
    const pid = await savePaper();
    setBusy(false);
    if (pid) toast('试卷已保存并挂载到讲次');
  };

  const onPublish = async () => {
    if (!lesson) return;
    setBusy(true);
    try {
      const pid = await savePaper();
      if (!pid) return;
      await api.post('/assignments', {
        body: {
          paperId: pid,
          lessonId,
          kind: 'homework',
          target: { courseId: lesson.courseId },
          dueAt: new Date(dueAt).toISOString(),
        },
      });
      toast(`作业已发布并挂载到讲次,下课后自动推送学生平板`);
      navigate(`/lessons/${lessonId}/arrange`);
    } catch (e) {
      toast(e instanceof Error ? e.message : '发布失败');
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
  if (!lesson) {
    return <EmptyState icon="▦" text="讲次不存在" action={<Button onClick={() => navigate('/courses')}>返回讲次列表</Button>} />;
  }

  return (
    <div>
      <PageHead
        title={(
          <span>
            <Link className="text-[15px] font-semibold text-primary hover:underline" to={`/lessons/${lessonId}/arrange`}>← 编排课堂</Link>
            <span className="text-ink-3"> / </span>{lesson.title} · 课后作业组卷
          </span>
        )}
        sub="从题库挑题组成作业,发布后挂载到讲次,下课自动推送学生平板"
        actions={(
          <>
            <Button onClick={() => setPickerOpen(true)}>+ 继续从题库选题</Button>
            <Button onClick={onSave} disabled={busy}>保存试卷</Button>
            <Button variant="primary" onClick={onPublish} disabled={busy}>发布作业</Button>
          </>
        )}
      />

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

        {/* 右:发布设置 */}
        <Card title="发布设置">
          <div className="flex flex-col gap-3.5 text-[13px]">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-ink-2">作业名称</span>
              <input
                className="rounded-[10px] border-[1.5px] border-line px-3 py-2 text-[13px] focus:border-primary focus:outline-none"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-ink-2">截止时间</span>
              <input
                type="datetime-local"
                className="rounded-[10px] border-[1.5px] border-line px-3 py-2 text-[13px] tabular-nums focus:border-primary focus:outline-none"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </label>
            <div className="flex items-center justify-between rounded-md bg-bg px-3 py-2.5 text-xs text-ink-2">
              <span>解答题批改</span>
              <Tag tone="violet">AI 预批 + 教师复核</Tag>
            </div>
            <div className="rounded-md bg-bg px-3 py-2.5 text-xs leading-relaxed text-ink-3">
              发布即生效:下课后推送学生平板,截止 {fmtDateTime(new Date(dueAt).toISOString())};客观题提交后立即自动批改。
            </div>
          </div>
        </Card>
      </div>

      {/* 题库选题弹窗(B3 题库同源数据:仅已入库题) */}
      <QuestionPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        questions={questions}
        items={items}
        onToggle={(q) => (items.some((it) => it.questionId === q.id) ? remove(q.id) : add(q))}
      />
    </div>
  );
}
