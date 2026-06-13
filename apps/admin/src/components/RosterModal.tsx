/** 班级名单弹窗(原型 modalRoster):到课 / 作业均分 / 状态 / 档案入口 + 入班(添加/移出) */
import { useCallback, useEffect, useState } from 'react';
import type { CourseDto, StudentDto } from '@qiming/contracts';
import { Button, EmptyState, Modal, Skeleton, Table, Tag, useToast } from '@qiming/ui';
import { api } from '../api';
import { ConfirmModal } from './ConfirmModal';
import { LinkButton, TextInput } from './controls';

interface RosterRow { studentId: number; name: string; attendance: string; homeworkAvg: number | null; status: string }

export interface RosterModalProps {
  /** 为 null 时关闭 */
  course: CourseDto | null;
  onClose: () => void;
  onOpenProfile: (studentId: number) => void;
  /** 名单发生增减时通知父页刷新课程卡(studentCount 等) */
  onChanged?: () => void;
}

export function RosterModal({ course, onClose, onOpenProfile, onChanged }: RosterModalProps) {
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<RosterRow | null>(null);
  const { toast } = useToast();

  const load = useCallback(async (courseId: number) => {
    setLoading(true);
    try {
      const r = await api.get('/admin/courses/{id}/roster', { params: { id: courseId } });
      setRows(r.data as RosterRow[]);
    } catch {
      toast('名单加载失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!course) return;
    setRows([]);
    void load(course.id);
  }, [course, load]);

  const removeStudent = async () => {
    if (!course || !removing) return;
    try {
      await api.del('/admin/courses/{id}/students/{studentId}', { params: { id: course.id, studentId: removing.studentId } });
      toast(`已将 ${removing.name} 移出本课程`);
      await load(course.id);
      onChanged?.();
    } catch {
      toast('移出失败,请重试');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <>
      <Modal
        open={!!course}
        title={course ? `${course.name} · 学生名单(${rows.length} 人)` : ''}
        onClose={onClose}
        width={560}
        footer={
          <>
            <Button onClick={onClose}>关闭</Button>
            <Button variant="primary" onClick={() => setAddOpen(true)} disabled={!course}>+ 添加学生</Button>
          </>
        }
      >
        <div className="-mx-6 -my-5">
          <Table<RosterRow>
            loading={loading}
            rows={rows}
            rowKey={(r) => r.studentId}
            emptyText="该课程暂无学生,点击「+ 添加学生」入班"
            columns={[
              { key: 'name', title: '姓名', render: (r) => <b>{r.name}</b> },
              { key: 'attendance', title: '到课' },
              { key: 'homeworkAvg', title: '作业均分', render: (r) => (r.homeworkAvg != null ? r.homeworkAvg : '—') },
              {
                key: 'status', title: '状态',
                render: (r) =>
                  r.status !== 'active' ? <Tag>停用</Tag>
                  : r.homeworkAvg != null && r.homeworkAvg < 60 ? <Tag tone="red">需关注</Tag>
                  : <Tag tone="green">正常</Tag>,
              },
              {
                key: 'ops', title: '操作',
                render: (r) => (
                  <span className="flex gap-3">
                    <LinkButton onClick={() => onOpenProfile(r.studentId)}>档案</LinkButton>
                    <LinkButton danger onClick={() => setRemoving(r)}>移出</LinkButton>
                  </span>
                ),
              },
            ]}
          />
        </div>
      </Modal>

      {course && (
        <AddStudentsModal
          open={addOpen}
          course={course}
          enrolledIds={rows.map((r) => r.studentId)}
          onClose={() => setAddOpen(false)}
          onAdded={async () => {
            setAddOpen(false);
            await load(course.id);
            onChanged?.();
          }}
        />
      )}

      <ConfirmModal
        open={!!removing}
        title="移出课程"
        confirmText="确认移出"
        onConfirm={removeStudent}
        onClose={() => setRemoving(null)}
      >
        确定把 <b className="text-ink">{removing?.name}</b> 移出「{course?.name}」吗?移出后该生在本课程的课堂与作业入口将关闭(历史数据保留)。
      </ConfirmModal>
    </>
  );
}

/** 添加学生子弹窗:列出未在本课程的学生,可多选后批量入班 */
function AddStudentsModal({
  open, course, enrolledIds, onClose, onAdded,
}: {
  open: boolean;
  course: CourseDto;
  enrolledIds: number[];
  onClose: () => void;
  onAdded: () => void | Promise<void>;
}) {
  const [candidates, setCandidates] = useState<StudentDto[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setCandidates(null);
    setSelected(new Set());
    setKeyword('');
    const enrolled = new Set(enrolledIds); // 仅在打开瞬间快照,避免父级重渲染反复拉取
    api.get('/admin/students', { query: { page: 1, size: 100 } })
      .then((r) => setCandidates((r.data.items as StudentDto[]).filter((s) => !enrolled.has(s.id))))
      .catch(() => { toast('学生列表加载失败'); setCandidates([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, course.id, toast]);

  const filtered = (candidates ?? []).filter(
    (s) => !keyword.trim() || s.name.includes(keyword.trim()) || s.studentNo.includes(keyword.trim()),
  );

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const submit = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await api.post('/admin/courses/{id}/students', { params: { id: course.id }, body: { studentIds: [...selected] } });
      toast(`已添加 ${selected.size} 名学生入班`);
      await onAdded();
    } catch {
      toast('添加失败,请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`添加学生 · ${course.name}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={busy || selected.size === 0}>
            {busy ? '添加中…' : `确认添加${selected.size ? ` (${selected.size})` : ''}`}
          </Button>
        </>
      }
    >
      <div className="mb-3">
        <TextInput
          className="w-full"
          placeholder="搜索姓名 / 学号"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>
      {candidates == null ? (
        <Skeleton className="h-40 w-full" lines={5} />
      ) : filtered.length === 0 ? (
        <EmptyState icon="✓" text={candidates.length === 0 ? '机构内学生都已在本课程' : '没有匹配的学生'} />
      ) : (
        <div className="flex max-h-[46vh] flex-col gap-1.5 overflow-auto">
          {filtered.map((s) => {
            const checked = selected.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle(s.id)}
                className={`flex items-center justify-between rounded-md border-[1.5px] px-3.5 py-2.5 text-left text-[13.5px] ${
                  checked ? 'border-primary bg-primary-soft font-bold text-primary' : 'border-line hover:border-ink-3'
                }`}
              >
                <span>{s.name} <span className="text-xs font-normal text-ink-3">· {s.studentNo} · {s.grade}</span></span>
                <span className={`flex h-5 w-5 items-center justify-center rounded-[6px] border ${checked ? 'border-primary bg-primary text-card' : 'border-line'}`}>
                  {checked ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
