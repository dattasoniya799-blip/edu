/** 课程与班级(原型 a-courses):课程卡片 + 新建课程弹窗 + 名单弹窗(→ 学生档案) */
import { useCallback, useEffect, useState } from 'react';
import type { CourseDto, TeacherDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Skeleton, Tag, useToast } from '@qiming/ui';
import { api } from '../api';
import { CourseFormModal } from '../components/CourseFormModal';
import { RosterModal } from '../components/RosterModal';
import { StudentProfileModal } from '../components/StudentProfileModal';
import { formatDateCn } from '../lib/format';
import { CLASS_TYPE_LABEL, CLASS_TYPE_TONE } from '../lib/labels';
import { PageHead } from './Shell';

export function Courses() {
  const [courses, setCourses] = useState<CourseDto[]>([]);
  const [teachers, setTeachers] = useState<TeacherDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [rosterCourse, setRosterCourse] = useState<CourseDto | null>(null);
  const [profileId, setProfileId] = useState<number | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/courses', { query: { page: 1, size: 50 } });
      setCourses(r.data.items as CourseDto[]); // openapi 里 Course.status 为宽松 string,这里收敛为 DTO
    } catch {
      toast('课程列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    api.get('/admin/teachers', { query: { page: 1, size: 50 } })
      .then((r) => setTeachers(r.data.items))
      .catch(() => undefined);
  }, []);

  return (
    <div>
      <PageHead
        title="课程与班级"
        sub="支持班课 / 一对一 / 一对三 · 课程是排课、课堂与学情统计的基本单位"
        actions={<Button variant="primary" onClick={() => setCreateOpen(true)}>+ 新建课程</Button>}
      />
      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[196px] w-full !rounded-lg" />)}
        </div>
      ) : courses.length === 0 ? (
        <Card>
          <EmptyState
            icon="▦"
            text="还没有课程"
            hint="新建课程后,系统自动生成全部讲次,教师可逐讲编排课堂"
            action={<Button variant="primary" onClick={() => setCreateOpen(true)}>+ 新建课程</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {courses.map((c) => (
            <div key={c.id} className="flex flex-col gap-2.5 rounded-lg border border-line bg-card p-5 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <b className="text-[15.5px] text-ink">{c.name}</b>
                <Tag tone={CLASS_TYPE_TONE[c.classType]}>{CLASS_TYPE_LABEL[c.classType]}</Tag>
              </div>
              <div className="text-[12.5px] text-ink-2">
                {c.teacherName}老师 · {c.studentCount} 名学生 · {c.stage} {c.subject}
              </div>
              <div className="rounded-[10px] bg-primary-soft px-3.5 py-2.5 text-[12.5px] text-primary-deep">
                进度 <b className="font-extrabold tabular-nums">第 {c.currentLesson} / {c.totalLessons} 讲</b>
                {' · '}下次上课 <b className="font-extrabold">{c.nextLessonAt ? formatDateCn(c.nextLessonAt) : '待教师排课'}</b>
              </div>
              <div className="flex gap-3.5 text-xs tabular-nums text-ink-3">
                <span>到课率 {c.attendanceRate != null ? `${c.attendanceRate}%` : '—'}</span>
                <span>作业完成率 {c.homeworkRate != null ? `${c.homeworkRate}%` : '—'}</span>
              </div>
              <div className="mt-auto flex gap-2.5 pt-1">
                <button
                  type="button"
                  className="flex-1 rounded-[10px] border-[1.5px] border-line py-[9px] text-[12.5px] font-bold text-ink-2 transition-colors hover:border-ink-3"
                  onClick={() => setRosterCourse(c)}
                >
                  学生名单
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-[10px] bg-primary py-[9px] text-[12.5px] font-bold text-card shadow-btn-sm transition-colors hover:bg-primary-deep"
                  onClick={() => toast('管理员为只读视图,完整讲次详情见教师端「我的课程」')}
                >
                  讲次与学情
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CourseFormModal open={createOpen} teachers={teachers} onClose={() => setCreateOpen(false)} onSaved={() => void load()} />
      <RosterModal
        course={rosterCourse}
        onClose={() => setRosterCourse(null)}
        onOpenProfile={(id) => { setRosterCourse(null); setProfileId(id); }}
        onChanged={() => void load()}
      />
      <StudentProfileModal studentId={profileId} onClose={() => setProfileId(null)} />
    </div>
  );
}
