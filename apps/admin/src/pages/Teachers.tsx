/** 教师管理(原型 a-teachers):筛选 + 列表 + 添加/编辑 + 重置密码 + 停用 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { TeacherDto, UserStatus } from '@qiming/contracts';
import { Button, Card, Table, Tag, useToast } from '@qiming/ui';
import { api } from '../api';
import { ConfirmModal } from '../components/ConfirmModal';
import { LinkButton, Select, TextInput, Toolbar } from '../components/controls';
import { Pager } from '../components/Pager';
import { TeacherFormModal } from '../components/TeacherFormModal';
import { SUBJECT_TONE, TEACHER_STATUS } from '../lib/labels';
import { PageHead } from './Shell';

const SIZE = 10;

export function Teachers() {
  const [rows, setRows] = useState<TeacherDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  // 弹窗状态
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TeacherDto | null>(null);
  const [resetTarget, setResetTarget] = useState<TeacherDto | null>(null);
  const [disableTarget, setDisableTarget] = useState<TeacherDto | null>(null);
  const { toast } = useToast();
  const location = useLocation();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/teachers', {
        query: {
          page, size: SIZE,
          ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
          ...(status ? { status: status as UserStatus } : {}),
        },
      });
      setRows(r.data.items);
      setTotal(r.data.total);
    } catch {
      toast('教师列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, keyword, status, toast]);

  useEffect(() => { void load(); }, [load]);

  // 数据总览「+ 添加教师」跳转进来时自动开弹窗
  useEffect(() => {
    if ((location.state as { openAdd?: boolean } | null)?.openAdd) {
      setEditing(null);
      setFormOpen(true);
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  const openAdd = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (t: TeacherDto) => { setEditing(t); setFormOpen(true); };

  const resetPassword = async () => {
    if (!resetTarget) return;
    await api.post('/admin/teachers/{id}/reset-password', { params: { id: resetTarget.id } });
    toast('已重置密码并短信通知');
    setResetTarget(null);
  };

  const disableTeacher = async () => {
    if (!disableTarget) return;
    await api.del('/admin/teachers/{id}', { params: { id: disableTarget.id } });
    toast(`已停用 ${disableTarget.name} 的账号`);
    setDisableTarget(null);
    await load();
  };

  return (
    <div>
      <PageHead
        title="教师管理"
        sub={`共 ${total} 名教师 · 教师使用电脑端登录`}
        actions={<Button variant="primary" onClick={openAdd}>+ 添加教师</Button>}
      />
      <Card bodyClassName="!p-0">
        <Toolbar>
          <TextInput
            className="w-60"
            placeholder="搜索姓名 / 工号 / 手机号"
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
          />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">全部状态</option>
            <option value="active">在职</option>
            <option value="disabled">已停用</option>
            <option value="pending">待激活</option>
          </Select>
        </Toolbar>
        <Table<TeacherDto>
          loading={loading}
          rows={rows}
          rowKey={(t) => t.id}
          emptyText="还没有教师,点击右上角「+ 添加教师」"
          columns={[
            { key: 'name', title: '姓名', render: (t) => <b>{t.name}</b> },
            { key: 'teacherNo', title: '工号' },
            {
              key: 'subject', title: '学段/学科',
              render: (t) => <Tag tone={SUBJECT_TONE[t.subject] ?? 'primary'}>{t.stage} · {t.subject}</Tag>,
            },
            { key: 'courseCount', title: '在带课程', render: (t) => (t.courseCount > 0 ? `${t.courseCount} 门` : '—') },
            { key: 'contrib', title: '题库贡献', render: (t) => `${t.questionCount} 题 / ${t.resourceCount} 课件` },
            { key: 'status', title: '状态', render: (t) => <Tag tone={TEACHER_STATUS[t.status].tone}>{TEACHER_STATUS[t.status].label}</Tag> },
            {
              key: 'ops', title: '操作',
              render: (t) => (
                <span className="flex gap-3">
                  <LinkButton onClick={() => openEdit(t)}>编辑</LinkButton>
                  {t.status !== 'disabled' && (
                    <>
                      <LinkButton onClick={() => setResetTarget(t)}>重置密码</LinkButton>
                      <LinkButton danger onClick={() => setDisableTarget(t)}>停用</LinkButton>
                    </>
                  )}
                </span>
              ),
            },
          ]}
        />
        {!loading && <Pager page={page} size={SIZE} total={total} onChange={setPage} />}
      </Card>

      <TeacherFormModal open={formOpen} initial={editing} onClose={() => setFormOpen(false)} onSaved={() => void load()} />
      <ConfirmModal
        open={!!resetTarget}
        title="重置密码"
        confirmText="重置并短信通知"
        onConfirm={resetPassword}
        onClose={() => setResetTarget(null)}
      >
        将为 <b className="text-ink">{resetTarget?.name}</b>({resetTarget?.teacherNo})生成新的初始密码并短信发送至其手机,旧密码立即失效。
      </ConfirmModal>
      <ConfirmModal
        open={!!disableTarget}
        title="停用教师账号"
        confirmText="确认停用"
        onConfirm={disableTeacher}
        onClose={() => setDisableTarget(null)}
      >
        停用后 <b className="text-ink">{disableTarget?.name}</b> 将无法登录,其名下课程不受影响。确定停用吗?
      </ConfirmModal>
    </div>
  );
}
