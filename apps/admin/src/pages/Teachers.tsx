import { useEffect, useState } from 'react';
import type { TeacherDto } from '@qiming/contracts';
import { Button, Card, Table, Tag, useToast } from '@qiming/ui';
import { api } from '../api';
import { PageHead } from './Shell';

const STATUS_TAG = { active: ['green', '正常'], disabled: ['red', '已停用'], pending: ['orange', '待激活'] } as const;

export function Teachers() {
  const [rows, setRows] = useState<TeacherDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    api.get('/admin/teachers', { query: { page: 1, size: 20 } })
      .then((r) => { setRows(r.data.items); setTotal(r.data.total); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHead
        title="教师管理"
        sub={`共 ${total} 名教师 · 教师使用电脑端登录`}
        actions={<Button variant="primary" onClick={() => toast('B2 任务实现新增教师')}>+ 添加教师</Button>}
      />
      <Card bodyClassName="!p-0">
        <Table<TeacherDto>
          loading={loading}
          rows={rows}
          rowKey={(t) => t.id}
          emptyText="还没有教师,点击右上角添加"
          columns={[
            { key: 'name', title: '姓名', render: (t) => <b>{t.name}</b> },
            { key: 'teacherNo', title: '工号' },
            { key: 'subject', title: '学段学科', render: (t) => `${t.stage} · ${t.subject}` },
            { key: 'courseCount', title: '在带课程' },
            { key: 'questionCount', title: '题目数' },
            { key: 'status', title: '状态', render: (t) => <Tag tone={STATUS_TAG[t.status][0]}>{STATUS_TAG[t.status][1]}</Tag> },
          ]}
        />
      </Card>
    </div>
  );
}
