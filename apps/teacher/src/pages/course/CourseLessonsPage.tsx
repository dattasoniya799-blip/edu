/**
 * 我的课程 · 讲次时间线(原型 v0.4 id=t-course)
 * 课程切换 → 讲次纵向时间线(rail 圆点 + 状态胶囊 + 备课清单进度 + 入口操作)
 * 排课(MVP 口径,裁剪手册):管理员建课自动生成空讲次,上课时间由教师在本页
 * 逐讲「设置时间」(PUT /lessons/{id});RRULE 自动排课延后。
 * 裁剪口径:「追加讲次」由管理员在课程管理调总讲次数(契约无教师创建讲次端点);
 * 「从往期复制编排」「预览学生端」延后
 */
import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CourseDto, LessonDto } from '@qiming/contracts';
import { Button, EmptyState, Modal, Skeleton, Tag, useToast } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import { CHECKLIST_KEYS, CHECKLIST_LABEL } from '../lesson/lib/segments';
import { nextArrangeLessonId } from './lib/nav';
import { fmtDate, fmtDateTime, fmtTime } from './lib/format';
import { schedulePayload, scheduleFormFrom, validateSchedule, type ScheduleForm } from './lib/schedule';

const CLASS_TYPE_LABEL = { group: '班课', one_on_one: '一对一', one_on_three: '一对三' } as const;

/** 时间线圆点 */
function RailDot({ lesson, isNext }: { lesson: LessonDto; isNext: boolean }) {
  if (lesson.status === 'finished')
    return <div className="flex h-8 w-8 items-center justify-center rounded-pill bg-green-soft text-[13px] font-bold text-green">✓</div>;
  if (isNext || lesson.status === 'ready')
    return <div className="flex h-8 w-8 items-center justify-center rounded-pill bg-primary text-[13px] font-bold text-card">{lesson.seq}</div>;
  return <div className="flex h-8 w-8 items-center justify-center rounded-pill bg-bg text-[13px] font-bold text-ink-3">{lesson.seq}</div>;
}

function StatusTag({ lesson, isNext }: { lesson: LessonDto; isNext: boolean }) {
  if (lesson.status === 'finished') return <Tag tone="green">已上课</Tag>;
  if (lesson.status === 'ready') return <Tag tone="green">已就绪 ✓</Tag>;
  if (lesson.status === 'in_progress') return <Tag tone="orange">上课中</Tag>;
  return isNext ? <Tag tone="primary">下次上课</Tag> : <Tag>未备课</Tag>;
}

/** 备课清单进度行(prepChecklist 非空时显示) */
function ChecklistMeta({ checklist }: { checklist: Record<string, boolean> }) {
  const keys = CHECKLIST_KEYS.filter((k) => k in checklist);
  if (keys.length === 0) return null;
  const done = keys.filter((k) => checklist[k]).length;
  return (
    <span>
      备课进度 {done}/{keys.length}:
      {keys.map((k) => (
        <span key={k} className={`ml-2 ${checklist[k] ? '' : 'font-bold text-red'}`}>
          {CHECKLIST_LABEL[k]} {checklist[k] ? '✓' : '✕'}
        </span>
      ))}
    </span>
  );
}

const LINK_CLS = 'text-[13px] font-semibold text-primary hover:underline';
const INPUT_CLS = 'w-full rounded-[10px] border-[1.5px] border-line px-3 py-2 text-[13.5px] outline-none focus:border-primary';

/** 表单字段(标签 + 错误文案;文件内局部,口径同 admin controls.Field) */
function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-1 flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-ink-2">{label}</span>
      {children}
      {error && <span className="text-xs font-semibold text-red">{error}</span>}
    </label>
  );
}

/** 设置/调整上课时间(排课 MVP:手动逐讲设时间,PUT /lessons/{id}) */
function ScheduleModal({ lesson, onClose, onSaved }: {
  lesson: LessonDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<ScheduleForm>({ title: '', date: '', start: '', end: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!lesson) return;
    setForm(scheduleFormFrom(lesson));
    setErrors({});
  }, [lesson]);

  const set = (k: keyof ScheduleForm) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!lesson) return;
    const errs = validateSchedule(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.put('/lessons/{id}', { params: { id: lesson.id }, body: schedulePayload(form) });
      toast('上课时间已保存');
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
      open={lesson != null}
      title={lesson ? `第 ${lesson.seq} 讲 · ${lesson.scheduledStart ? '调整时间' : '设置上课时间'}` : ''}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : '保存时间'}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <Field label="讲次标题" error={errors.title}>
          <input className={INPUT_CLS} value={form.title} onChange={set('title')} placeholder="如:一次函数的图像" />
        </Field>
        <Field label="上课日期" error={errors.date}>
          <input className={INPUT_CLS} type="date" value={form.date} onChange={set('date')} />
        </Field>
        <div className="flex gap-4">
          <Field label="开始时间" error={errors.start}>
            <input className={INPUT_CLS} type="time" value={form.start} onChange={set('start')} />
          </Field>
          <Field label="结束时间" error={errors.end}>
            <input className={INPUT_CLS} type="time" value={form.end} onChange={set('end')} />
          </Field>
        </div>
        <div className="rounded-[10px] bg-bg px-3.5 py-2.5 text-[12.5px] text-ink-3">
          按 MVP 口径逐讲手动设时间;需增减讲次请联系管理员在「课程与班级」中调整总讲次数。
        </div>
      </div>
    </Modal>
  );
}

export function CourseLessonsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [courses, setCourses] = useState<CourseDto[]>([]);
  const [lessons, setLessons] = useState<LessonDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false); // REV-front #2:讲次加载失败(可重试)区别于空态
  const [reload, setReload] = useState(0);
  const [scheduling, setScheduling] = useState<LessonDto | null>(null); // 排期弹窗当前讲次

  const courseId = Number(searchParams.get('courseId')) || courses[0]?.id || 0;
  const course = courses.find((c) => c.id === courseId);

  useEffect(() => {
    api.get('/teacher/courses').then((r) => setCourses(r.data as CourseDto[])).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!courseId) return;
    setLoading(true);
    setError(false);
    api.get('/courses/{id}/lessons', { params: { id: courseId } })
      .then((r) => setLessons(r.data as LessonDto[]))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [courseId, reload]);

  /** 下一讲 = 按 seq 第一个未结课讲次 */
  const nextLessonId = useMemo(() => nextArrangeLessonId(lessons), [lessons]);

  // C2 #8:工作台「编排课堂」带 go=arrange → 讲次载入后直接进下一讲编排页(落点区别于「讲次列表」)
  useEffect(() => {
    if (loading || searchParams.get('go') !== 'arrange') return;
    if (nextLessonId != null) {
      navigate(`/lessons/${nextLessonId}/arrange`);
    } else {
      // 无可编排讲次:停留时间线并清除标记
      setSearchParams({ courseId: String(courseId) }, { replace: true });
    }
  }, [loading, searchParams, nextLessonId, navigate, courseId, setSearchParams]);

  return (
    <div>
      <PageHead
        title={course ? `${course.name} · 讲次` : '我的课程'}
        sub={course && (
          <span className="inline-flex flex-wrap items-center gap-2">
            <Tag tone={course.classType === 'one_on_one' ? 'violet' : 'primary'}>{CLASS_TYPE_LABEL[course.classType]}</Tag>
            {course.studentCount} 名学生 · 共 {course.totalLessons} 讲 · {course.teacherName}
            {course.nextLessonAt && <> · 下次上课 {fmtDateTime(course.nextLessonAt)}</>}
          </span>
        )}
        actions={(
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
        <Skeleton lines={4} className="h-24 w-full" />
      ) : error ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState icon="⚠" text="讲次加载失败" hint="可能是网络波动,请重试"
            action={<Button variant="primary" onClick={() => setReload((n) => n + 1)}>重新加载</Button>} />
        </div>
      ) : lessons.length === 0 ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState icon="▦" text="该课程还没有讲次" hint="请联系管理员在「课程与班级」设置总讲次数;生成讲次后可在本页逐讲设置上课时间" />
        </div>
      ) : (
        lessons.map((lesson, i) => {
          const isNext = lesson.id === nextLessonId;
          return (
            <div key={lesson.id} className="flex gap-4">
              <div className="flex w-8 flex-col items-center">
                <RailDot lesson={lesson} isNext={isNext} />
                {i < lessons.length - 1 && <div className="w-px flex-1 bg-line" />}
              </div>
              <div
                className={`mb-4 flex-1 rounded-lg border bg-card p-4 shadow-card ${
                  isNext ? 'border-primary' : 'border-line'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <b className="text-sm">{lesson.title}</b>
                  <StatusTag lesson={lesson} isNext={isNext} />
                  <span className="ml-auto text-xs text-ink-3">
                    {fmtDate(lesson.scheduledStart)}
                    {lesson.scheduledStart && lesson.scheduledEnd && (
                      <> {fmtTime(lesson.scheduledStart)}–{fmtTime(lesson.scheduledEnd)}</>
                    )}
                  </span>
                </div>
                {Object.keys(lesson.prepChecklist).length > 0 && lesson.status !== 'finished' && (
                  <div className="mt-2 text-[12.5px] text-ink-2"><ChecklistMeta checklist={lesson.prepChecklist} /></div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  {lesson.status === 'finished' ? (
                    <>
                      <Link className={LINK_CLS} to="/grading">作业批改</Link>
                      <Link className={LINK_CLS} to={`/analytics?courseId=${courseId}`}>本讲学情</Link>
                    </>
                  ) : isNext ? (
                    <Button variant="primary" className="!px-3.5 !py-[7px]" onClick={() => navigate(`/lessons/${lesson.id}/arrange`)}>
                      编排课堂流程
                    </Button>
                  ) : (
                    <button type="button" className={LINK_CLS} onClick={() => navigate(`/lessons/${lesson.id}/arrange`)}>
                      {lesson.status === 'ready' ? '查看编排' : '开始备课'}
                    </button>
                  )}
                  {/* 排课(MVP 手动逐讲):上课中/已结课不可改时间 */}
                  {lesson.status !== 'finished' && lesson.status !== 'in_progress' && (
                    <button type="button" className={LINK_CLS} onClick={() => setScheduling(lesson)}>
                      {lesson.scheduledStart ? '调整时间' : '设置上课时间'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}

      <ScheduleModal
        lesson={scheduling}
        onClose={() => setScheduling(null)}
        onSaved={() => setReload((n) => n + 1)}
      />
    </div>
  );
}
