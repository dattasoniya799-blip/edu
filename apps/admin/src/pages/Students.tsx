import { useEffect, useState } from 'react';
import type { StudentDto } from '@qiming/contracts';
import { Button, Card, Table, Tag, useToast } from '@qiming/ui';
import { api } from '../api';
import { PageHead } from './Shell';

export function Students() {
  const [rows, setRows] = useState<StudentDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    api.get('/admin/students', { query: { page: 1, size: 20 } })
      .then((r) => { setRows(r.data.items); setTotal(r.data.total); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHead
        title="学生管理"
        sub={`共 ${total} 名学生 · 平板首次登录需扫码绑定`}
        actions={<Button variant="primary" onClick={() => toast('B2 任务实现新增学生')}>+ 添加学生</Button>}
      />
      <Card bodyClassName="!p-0">
        <Table<StudentDto>
          loading={loading}
          rows={rows}
          rowKey={(s) => s.id}
          emptyText="还没有学生"
          columns={[
            { key: 'name', title: '姓名', render: (s) => <b>{s.name}</b> },
            { key: 'studentNo', title: '学号' },
            {
              key: 'courses', title: '在读课程',
              render: (s) => (
                <span className="flex flex-wrap gap-1">
                  {s.courses.map((c) => (
                    <Tag key={c.id} tone={c.classType === 'one_on_one' ? 'violet' : 'primary'}>{c.name}</Tag>
                  ))}
                </span>
              ),
            },
            {
              key: 'device', title: '设备',
              render: (s) => (s.device ? <Tag tone="green">{s.device.name} · 已绑定</Tag> : <Tag>未绑定</Tag>),
            },
            {
              key: 'weekStudySec', title: '本周学习时长',
              render: (s) => `${Math.floor(s.weekStudySec / 3600)} h ${Math.floor((s.weekStudySec % 3600) / 60)} min`,
            },
            {
              key: 'status', title: '状态',
              render: (s) => (s.status === 'active' ? <Tag tone="green">正常</Tag> : <Tag tone="orange">待激活</Tag>),
            },
          ]}
        />
      </Card>
    </div>
  );
}
