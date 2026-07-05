/**
 * 我的课程(原型 s-course 段):左侧课程卡 + 右侧讲次时间线(回看/订正入口)
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssignmentDto, CourseDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Modal, Skeleton, Tag, useToast } from '@qiming/ui';
import { api } from '../../api';
import { LessonTimeline, type TimelineItem } from './LessonTimeline';

const CLASS_TYPE_LABEL = { group: '班课', one_on_one: '一对一', one_on_three: '一对三' } as const;

export function CoursePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [courses, setCourses] = useState<CourseDto[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[] | null>(null);
  const [pending, setPending] = useState<AssignmentDto[]>([]);
  const [replay, setReplay] = useState<{ name: string; url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState(false); // 课程列表加载失败(整页可重试)
  const [reload, setReload] = useState(0);
  const [timelineError, setTimelineError] = useState(false); // 讲次时间线加载失败(局部可重试)
  const [tlReload, setTlReload] = useState(0);

  useEffect(() => {
    setCourses(null); setError(false);
    api.get('/student/courses')
      .then((r) => {
        const list = r.data as CourseDto[];
        setCourses(list);
        setActiveId((id) => id ?? list[0]?.id ?? null);
      })
      .catch(() => setError(true));
    api.get('/student/assignments', { query: { status: 'pending' } })
      .then((r) => setPending(r.data as AssignmentDto[]))
      .catch(() => setPending([]));
  }, [reload]);

  useEffect(() => {
    if (activeId == null) return;
    setTimeline(null);
    setTimelineError(false);
    api.get('/student/courses/{id}/lessons', { params: { id: activeId } })
      .then((r) => setTimeline(r.data as TimelineItem[]))
      .catch(() => setTimelineError(true));
  }, [activeId, tlReload]);

  // 订正入口:pending 的 correction 作业按 lessonId 匹配到讲次
  const correctionByLesson = Object.fromEntries(
    pending.filter((a) => a.kind === 'correction' && a.lessonId != null).map((a) => [a.lessonId as number, a.id]),
  ) as Record<number, number>;

  const openReplay = async (resourceId: number, name: string) => {
    try {
      const r = await api.get('/student/resources/{id}/view', { params: { id: resourceId } });
      const d = r.data as { url: string; expiresAt: string };
      setReplay({ name, url: d.url, expiresAt: d.expiresAt });
    } catch {
      toast('课件链接获取失败,请重试');
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-[1080px]">
        <div className="mb-5">
          <h2 className="text-[21px] font-extrabold">我的课程</h2>
          <p className="mt-1 text-[13px] text-ink-2">已上的讲次可以回看课件、订正错题</p>
        </div>
        <Card>
          <EmptyState icon="⚠" text="课程加载失败" hint="可能是网络波动,请重试"
            action={<Button variant="primary" className="min-h-touch" onClick={() => setReload((n) => n + 1)}>重新加载</Button>} />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1080px]">
      <div className="mb-5">
        <h2 className="text-[21px] font-extrabold">我的课程</h2>
        <p className="mt-1 text-[13px] text-ink-2">已上的讲次可以回看课件、订正错题</p>
      </div>

      {!courses ? (
        <div className="grid grid-cols-[260px_1fr] gap-4">
          <Skeleton className="h-20" lines={2} />
          <Skeleton className="h-24" lines={3} />
        </div>
      ) : courses.length === 0 ? (
        <Card><EmptyState text="还没有报名课程" hint="联系机构老师为你报名后,课程会出现在这里" /></Card>
      ) : (
        <div className="grid grid-cols-[260px_1fr] items-start gap-4">
          <div className="flex flex-col gap-3">
            {courses.map((c) => {
              const active = c.id === activeId;
              return (
                <button key={c.id} type="button" onClick={() => setActiveId(c.id)}
                  className={`min-h-touch rounded-lg border-[1.5px] bg-card p-4 text-left shadow-card transition-all ${active ? 'border-primary' : 'border-line hover:border-ink-3'}`}>
                  <div className="flex items-center gap-1.5">
                    <b className="text-sm">{c.name}</b>
                    <Tag tone={c.classType === 'group' ? 'primary' : 'violet'}>{CLASS_TYPE_LABEL[c.classType]}</Tag>
                  </div>
                  <div className="mt-1 text-xs text-ink-2">
                    {c.teacherName} 老师 · 第 {c.currentLesson}/{c.totalLessons} 讲
                  </div>
                  {c.nextLessonAt && (
                    <div className="mt-0.5 text-xs text-ink-3">
                      下次 {new Date(c.nextLessonAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div>
            {timelineError ? (
              <Card><EmptyState icon="⚠" text="讲次加载失败" hint="可能是网络波动,请重试"
                action={<Button variant="primary" className="min-h-touch" onClick={() => setTlReload((n) => n + 1)}>重新加载</Button>} /></Card>
            ) : !timeline ? (
              <Skeleton className="h-24" lines={3} />
            ) : timeline.length === 0 ? (
              <Card><EmptyState text="讲次安排准备中" hint="老师排课后这里会出现讲次时间线" /></Card>
            ) : (
              <LessonTimeline items={timeline} correctionByLesson={correctionByLesson}
                onReplay={openReplay}
                onCorrect={(id) => navigate(`/homework/${id}`)}
                onEnterClass={(_lesson, sessionId) => {
                  // C3 #3:用该讲自己的 sessionId(发布即建会话),不再借用全局 today 的会话
                  if (sessionId != null) navigate(`/classroom/${sessionId}`);
                  else toast('该讲次尚未发布,老师发布后即可进入课堂');
                }} />
            )}
          </div>
        </div>
      )}

      <Modal open={replay != null} title={`回看课件 · ${replay?.name ?? ''}`} onClose={() => setReplay(null)}>
        {replay && (
          <div className="text-sm leading-7 text-ink-2">
            <div className="flex h-44 items-center justify-center rounded-md border border-dashed border-line bg-bg/60 text-ink-3">
              课件在线预览即将上线,可先通过下方链接打开查看
            </div>
            <div className="mt-3 break-all text-xs text-ink-3">
              链接:{replay.url}
              <br />有效期至:{new Date(replay.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
