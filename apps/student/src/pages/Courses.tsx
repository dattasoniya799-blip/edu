import { useEffect, useState } from 'react';
import type { CourseDto } from '@qiming/contracts';
import { Card, EmptyState, ProgressBar, Tag } from '@qiming/ui';
import { api } from '../api';

const CLASS_TYPE_LABEL = { group: '班课', one_on_one: '一对一', one_on_three: '一对三' } as const;

export function Courses() {
  const [courses, setCourses] = useState<CourseDto[] | null>(null);

  useEffect(() => {
    api.get('/student/courses').then((r) => setCourses(r.data as CourseDto[])); // openapi Course.status 为宽松 string
  }, []);

  return (
    <div className="mx-auto max-w-[1040px]">
      <h2 className="mb-5 text-[21px] font-extrabold">我的课程</h2>
      {!courses ? (
        <Card><div className="h-20 animate-pulse rounded-md bg-bg" /></Card>
      ) : courses.length === 0 ? (
        <Card><EmptyState text="还没有报名课程" /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {courses.map((c) => (
            <Card key={c.id}>
              <div className="flex items-center justify-between">
                <b className="text-[15px]">{c.name}</b>
                <Tag tone={c.classType === 'one_on_one' ? 'violet' : 'primary'}>{CLASS_TYPE_LABEL[c.classType]}</Tag>
              </div>
              <div className="mt-1.5 text-xs text-ink-2">
                {c.teacherName} 老师 · 第 {c.currentLesson}/{c.totalLessons} 讲
                {c.nextLessonAt && ` · 下次 ${new Date(c.nextLessonAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
              </div>
              <ProgressBar className="mt-3.5" value={Math.round((c.currentLesson / c.totalLessons) * 100)} tone="primary" />
              <div className="mt-3 text-xs text-ink-3">讲次时间线与课件回看由 B5 任务交付</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
