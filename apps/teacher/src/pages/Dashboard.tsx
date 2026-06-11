import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CourseDto } from '@qiming/contracts';
import { Button, Card, EmptyState, ProgressBar, StatCard, Tag } from '@qiming/ui';
import { api } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { PageHead } from './Shell';

const CLASS_TYPE_LABEL = { group: '班课', one_on_one: '一对一', one_on_three: '一对三' } as const;

export function Dashboard() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseDto[]>([]);
  const [pending, setPending] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/teacher/courses'), api.get('/grading/pending')])
      .then(([c, g]) => {
        setCourses(c.data as CourseDto[]); // openapi Course.status 为宽松 string,收窄为 DTO 联合类型
        setPending(g.data.reduce((sum, x) => sum + x.pendingCount, 0));
      })
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div>
      <PageHead title={`${me?.name ?? ''} 老师,你好`} sub="今天的备课与批改安排都在这里" />
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard ribbon="primary" label="在带课程" value={loaded ? courses.length : '—'} />
        <Link to="/grading" aria-label="去批改复核">
          <StatCard ribbon="orange" label="待复核答卷" value={loaded ? pending : '—'} delta="点击进入批改复核 →" />
        </Link>
        <StatCard ribbon="green" label="本周课次" value={loaded ? courses.filter((c) => c.nextLessonAt).length : '—'} />
        <StatCard ribbon="violet" label="AI 预批" value="已开启" />
      </div>
      <Card title="我的课程">
        {!loaded || courses.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {courses.map((c) => (
              <div key={c.id} className="rounded-md border border-line p-4">
                <div className="flex items-center justify-between">
                  <b className="text-sm">{c.name}</b>
                  <Tag tone={c.classType === 'one_on_one' ? 'violet' : 'primary'}>{CLASS_TYPE_LABEL[c.classType]}</Tag>
                </div>
                <div className="mt-1.5 text-xs text-ink-2">
                  进度 第 {c.currentLesson}/{c.totalLessons} 讲 · {c.studentCount} 名学生
                  {c.nextLessonAt && ` · 下次 ${new Date(c.nextLessonAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                </div>
                <ProgressBar className="mt-3" value={Math.round((c.currentLesson / c.totalLessons) * 100)} tone="primary" />
                {/* B4:课程卡 → 讲次时间线 / 备课入口 */}
                <div className="mt-3.5 flex gap-2">
                  <Button className="!px-3 !py-1.5 !text-xs" onClick={() => navigate(`/courses?courseId=${c.id}`)}>讲次列表</Button>
                  <Button variant="primary" className="!px-3 !py-1.5 !text-xs" onClick={() => navigate(`/courses?courseId=${c.id}`)}>
                    {c.nextLessonAt ? '编排课堂' : '查看编排'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="还没有在带课程" hint="请联系管理员排课" />
        )}
      </Card>
    </div>
  );
}
