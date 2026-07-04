/** 学生管理(原型 a-students):筛选 + 列表 + 添加 + 档案 + 重置密码 + 停用 + 解绑(档案内) */
import { useCallback, useEffect, useState } from 'react';
import type { CourseDto, StudentDto, UserStatus } from '@qiming/contracts';
import { Button, Card, Table, Tag, useToast } from '@qiming/ui';
import { api } from '../api';
import { ConfirmModal } from '../components/ConfirmModal';
import { Select, TextInput, Toolbar, LinkButton } from '../components/controls';
import { ResetPasswordModal, type ResetPasswordTarget } from '../components/ResetPasswordModal';
import { Pager } from '../components/Pager';
import { StudentFormModal } from '../components/StudentFormModal';
import { StudentProfileModal } from '../components/StudentProfileModal';
import { formatDurationHM } from '../lib/format';
import { CLASS_TYPE_TONE, STUDENT_STATUS } from '../lib/labels';
import { PageHead } from './Shell';

const SIZE = 10;

export function Students() {
  const [rows, setRows] = useState<StudentDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [courseId, setCourseId] = useState('');
  const [courses, setCourses] = useState<CourseDto[]>([]);
  // 弹窗状态
  const [addOpen, setAddOpen] = useState(false);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [resetStudent, setResetStudent] = useState<ResetPasswordTarget | null>(null);
  const [disableTarget, setDisableTarget] = useState<StudentDto | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/students', {
        query: {
          page, size: SIZE,
          ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
          ...(status ? { status: status as UserStatus } : {}),
          ...(courseId ? { courseId: Number(courseId) } : {}),
        },
      });
      setRows(r.data.items);
      setTotal(r.data.total);
    } catch {
      toast('学生列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, keyword, status, courseId, toast]);

  const disableStudent = async () => {
    if (!disableTarget) return;
    // 与 Teachers 页同口径:停用失败不静默
    try {
      await api.del('/admin/students/{id}', { params: { id: disableTarget.id } });
      toast(`已停用 ${disableTarget.name} 的账号`);
      setDisableTarget(null);
      await load();
    } catch {
      toast('停用失败,请重试');
    }
  };

  const enableStudent = async (s: StudentDto) => {
    try {
      await api.post('/admin/students/{id}/enable', { params: { id: s.id } });
      toast(`已恢复启用 ${s.name}`);
      await load();
    } catch {
      toast('启用失败,请重试');
    }
  };

  useEffect(() => { void load(); }, [load]);

  // 课程筛选 + 添加学生的可选课程
  useEffect(() => {
    api.get('/admin/courses', { query: { page: 1, size: 50 } })
      .then((r) => setCourses(r.data.items as CourseDto[])) // openapi 里 Course.status 为宽松 string
      .catch(() => undefined);
  }, []);

  return (
    <div>
      <PageHead
        title="学生管理"
        sub={`共 ${total} 名学生 · 一名学生可同时报多门课程 · 学生用学号 + 密码登录平板`}
        actions={<Button variant="primary" onClick={() => setAddOpen(true)}>+ 添加学生</Button>}
      />
      <Card bodyClassName="!p-0">
        <Toolbar>
          <TextInput
            className="w-60"
            placeholder="搜索姓名 / 学号"
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
          />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">全部状态</option>
            <option value="active">正常</option>
            <option value="disabled">已停用</option>
            <option value="pending">待激活</option>
          </Select>
          <Select value={courseId} onChange={(e) => { setCourseId(e.target.value); setPage(1); }}>
            <option value="">全部课程</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Toolbar>
        <Table<StudentDto>
          loading={loading}
          rows={rows}
          rowKey={(s) => s.id}
          emptyText="还没有学生,点击右上角「+ 添加学生」"
          columns={[
            { key: 'name', title: '姓名', render: (s) => <b>{s.name}</b> },
            { key: 'studentNo', title: '学号' },
            {
              key: 'courses', title: '在读课程',
              render: (s) =>
                s.courses.length ? (
                  <span className="flex flex-wrap gap-1">
                    {s.courses.map((c) => <Tag key={c.id} tone={CLASS_TYPE_TONE[c.classType]}>{c.name}</Tag>)}
                  </span>
                ) : '—',
            },
            { key: 'weekStudySec', title: '近 7 日学习时长', render: (s) => formatDurationHM(s.weekStudySec) },
            { key: 'status', title: '状态', render: (s) => <Tag tone={STUDENT_STATUS[s.status].tone}>{STUDENT_STATUS[s.status].label}</Tag> },
            {
              key: 'ops', title: '操作',
              render: (s) => (
                <span className="flex gap-3">
                  <LinkButton onClick={() => setProfileId(s.id)}>详情</LinkButton>
                  {s.status === 'disabled' ? (
                    <LinkButton onClick={() => void enableStudent(s)}>恢复启用</LinkButton>
                  ) : (
                    <>
                      <LinkButton onClick={() => setResetStudent({ id: s.id, name: s.name, no: s.studentNo, role: 'student' })}>
                        重置密码
                      </LinkButton>
                      <LinkButton danger onClick={() => setDisableTarget(s)}>停用</LinkButton>
                    </>
                  )}
                </span>
              ),
            },
          ]}
        />
        {!loading && <Pager page={page} size={SIZE} total={total} onChange={setPage} />}
      </Card>

      <StudentFormModal
        open={addOpen}
        courses={courses}
        onClose={() => setAddOpen(false)}
        onSaved={(created) => {
          void load();
          // 创建后自动取首登明文密码(auto),直接弹窗展示,免去手动再点「重置密码」(P2-12)
          setResetStudent({ id: created.id, name: created.name, no: created.studentNo, role: 'student', auto: true });
        }}
      />
      <StudentProfileModal
        studentId={profileId}
        onClose={() => setProfileId(null)}
        onResetPassword={(t) => setResetStudent(t)}
      />
      <ResetPasswordModal target={resetStudent} onClose={() => setResetStudent(null)} />
      <ConfirmModal
        open={!!disableTarget}
        title="停用学生账号"
        confirmText="确认停用"
        onConfirm={disableStudent}
        onClose={() => setDisableTarget(null)}
      >
        停用后 <b className="text-ink">{disableTarget?.name}</b> 将无法登录,其学习数据保留。确定停用吗?
      </ConfirmModal>
    </div>
  );
}
