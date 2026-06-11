/** 班级名单弹窗(原型 modalRoster):到课 / 作业均分 / 状态 / 档案入口 */
import { useEffect, useState } from 'react';
import type { CourseDto } from '@qiming/contracts';
import { Button, Modal, Table, Tag, useToast } from '@qiming/ui';
import { api } from '../api';
import { LinkButton } from './controls';

interface RosterRow { studentId: number; name: string; attendance: string; homeworkAvg: number | null; status: string }

export interface RosterModalProps {
  /** 为 null 时关闭 */
  course: CourseDto | null;
  onClose: () => void;
  onOpenProfile: (studentId: number) => void;
}

export function RosterModal({ course, onClose, onOpenProfile }: RosterModalProps) {
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (!course) return;
    setLoading(true);
    setRows([]);
    api.get('/admin/courses/{id}/roster', { params: { id: course.id } })
      .then((r) => setRows(r.data as RosterRow[]))
      .catch(() => toast('名单加载失败'))
      .finally(() => setLoading(false));
  }, [course, toast]);

  return (
    <Modal
      open={!!course}
      title={course ? `${course.name} · 学生名单(${course.studentCount} 人)` : ''}
      onClose={onClose}
      width={560}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <div className="-mx-6 -my-5">
        <Table<RosterRow>
          loading={loading}
          rows={rows}
          rowKey={(r) => r.studentId}
          emptyText="该课程暂无学生"
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
            { key: 'ops', title: '操作', render: (r) => <LinkButton onClick={() => onOpenProfile(r.studentId)}>档案</LinkButton> },
          ]}
        />
      </div>
    </Modal>
  );
}
