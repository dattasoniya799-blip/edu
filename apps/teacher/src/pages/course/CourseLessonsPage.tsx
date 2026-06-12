/**
 * 我的课程 · 讲次时间线(原型 v0.4 id=t-course)
 * 课程切换 → 讲次纵向时间线(rail 圆点 + 状态胶囊 + 备课清单进度 + 入口操作)
 * 裁剪口径:「追加讲次」延后(契约无创建讲次端点);「从往期复制编排」「预览学生端」延后
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CourseDto, LessonDto } from '@qiming/contracts';
import { Button, EmptyState, Skeleton, Tag } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import { CHECKLIST_KEYS, CHECKLIST_LABEL } from '../lesson/lib/segments';
import { fmtDate, fmtDateTime } from './lib/format';

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

export function CourseLessonsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [courses, setCourses] = useState<CourseDto[]>([]);
  const [lessons, setLessons] = useState<LessonDto[]>([]);
  const [loading, setLoading] = useState(true);

  const courseId = Number(searchParams.get('courseId')) || courses[0]?.id || 0;
  const course = courses.find((c) => c.id === courseId);

  useEffect(() => {
    api.get('/teacher/courses').then((r) => setCourses(r.data as CourseDto[]));
  }, []);

  useEffect(() => {
    if (!courseId) return;
    setLoading(true);
    api.get('/courses/{id}/lessons', { params: { id: courseId } })
      .then((r) => setLessons(r.data as LessonDto[]))
      .finally(() => setLoading(false));
  }, [courseId]);

  /** 下一讲 = 按 seq 第一个未结课讲次 */
  const nextLessonId = useMemo(
    () => lessons.find((l) => l.status === 'draft' || l.status === 'ready')?.id ?? null,
    [lessons],
  );

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
      ) : lessons.length === 0 ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState icon="▦" text="该课程还没有讲次" hint="请联系管理员排课后再来备课" />
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
                  <span className="ml-auto text-xs text-ink-3">{fmtDate(lesson.scheduledStart)}</span>
                </div>
                {Object.keys(lesson.prepChecklist).length > 0 && lesson.status !== 'finished' && (
                  <div className="mt-2 text-[12.5px] text-ink-2"><ChecklistMeta checklist={lesson.prepChecklist} /></div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  {lesson.status === 'finished' ? (
                    <>
                      <Link className={LINK_CLS} to={`/lessons/${lesson.id}/monitor`}>课堂回放数据</Link>
                      <Link className={LINK_CLS} to="/grading">作业批改</Link>
                      <Link className={LINK_CLS} to="/analytics">本讲学情</Link>
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
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
