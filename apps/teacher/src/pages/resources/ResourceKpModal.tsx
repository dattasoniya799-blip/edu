/**
 * 资源挂知识点(2026-09-02 走查 A-3):契约 `PUT /resources/{id}` 早就收 `kpNodeId`,但资源库此前没有任何入口,
 * 编排页「本知识点」置顶与知识点库的关联资源永远空。这里给一个单选弹窗:学科 → 教材图谱 → 节点(关键词过滤)。
 * 上传成功后自动弹出(可跳过);卡片上也可随时改 / 清除。
 */
import { useEffect, useMemo, useState } from 'react';
import type { KpGraphDto, KpNodeDto, ResourceDto } from '@qiming/contracts';
import { Button, EmptyState, Modal, Skeleton, useToast } from '@qiming/ui';
import { api } from '../../api';
import { curriculumSubjects, pickKnowledgeGraph } from '../knowledge/lib/knowledge';

export interface ResourceKpModalProps {
  resource: ResourceDto | null;
  onClose: () => void;
  /** 保存成功回调(带回最新 kpNodeId / kpNodeName,父页面就地更新卡片) */
  onSaved: (id: number, kp: { kpNodeId: number | null; kpNodeName: string | null }) => void;
}

export function ResourceKpModal({ resource, onClose, onSaved }: ResourceKpModalProps) {
  const { toast } = useToast();
  const [graphs, setGraphs] = useState<KpGraphDto[]>([]);
  const [subject, setSubject] = useState('');
  const [nodes, setNodes] = useState<KpNodeDto[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = resource != null;

  useEffect(() => {
    if (!open) return;
    setKeyword('');
    Promise.all([api.get('/kp/graphs'), api.get('/teacher/courses').catch(() => ({ data: [] as { subject: string }[] }))])
      .then(([g, c]) => {
        setGraphs(g.data);
        const subjects = curriculumSubjects(g.data);
        const fromCourse = c.data.map((x) => x.subject).find((s) => subjects.includes(s));
        setSubject(fromCourse ?? subjects[0] ?? '');
      })
      .catch(() => setError(true));
  }, [open]);

  useEffect(() => {
    if (!open || !graphs.length) return;
    const graph = pickKnowledgeGraph(graphs, subject);
    if (!graph) { setNodes([]); return; }
    setLoading(true);
    setError(false);
    api.get('/kp/nodes', { query: { graphId: graph.id } })
      .then((r) => setNodes(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [open, graphs, subject]);

  const subjects = useMemo(() => curriculumSubjects(graphs), [graphs]);
  const shown = useMemo(() => {
    const kw = keyword.trim();
    return (kw ? nodes.filter((n) => n.name.includes(kw) || (n.chapter?.includes(kw) ?? false)) : nodes).slice(0, 200);
  }, [nodes, keyword]);

  const save = async (kpNodeId: number | null, kpNodeName: string | null) => {
    if (!resource) return;
    setBusy(true);
    try {
      await api.put('/resources/{id}', { params: { id: resource.id }, body: { kpNodeId } });
      onSaved(resource.id, { kpNodeId, kpNodeName });
      toast(kpNodeId == null ? '已清除知识点' : `已归档到「${kpNodeName}」,编排该知识点单元时会置顶推荐`);
      onClose();
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : '保存失败,请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={resource ? `归档知识点 · ${resource.name}` : ''}
      onClose={onClose}
      footer={(
        <>
          {resource?.kpNodeId != null && (
            <Button disabled={busy} onClick={() => void save(null, null)}>清除知识点</Button>
          )}
          <Button onClick={onClose} disabled={busy}>{resource?.kpNodeId == null ? '暂不归档' : '关闭'}</Button>
        </>
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        {subjects.length > 1 && (
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="学科"
            className="rounded-[10px] border-[1.5px] border-line bg-card px-2.5 py-[7px] text-[13px] outline-none focus:border-primary"
          >
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索知识点 / 章节"
          aria-label="搜索知识点"
          className="flex-1 rounded-[10px] border-[1.5px] border-line px-3 py-[7px] text-[13px] outline-none focus:border-primary"
        />
      </div>
      {resource?.kpNodeId != null && (
        <div className="mb-2 text-[12.5px] text-ink-2">当前:📘 {resource.kpNodeName ?? `节点 #${resource.kpNodeId}`}</div>
      )}
      {error ? (
        <EmptyState icon="⚠" text="知识点加载失败" hint="可能是网络波动,请关闭后重试" className="py-6" />
      ) : loading ? (
        <Skeleton lines={5} className="h-40 w-full" />
      ) : shown.length === 0 ? (
        <EmptyState icon="◌" text={keyword.trim() ? '没有匹配的知识点' : `「${subject}」暂无教材知识图谱`} className="py-6" />
      ) : (
        <div className="flex max-h-[50vh] flex-col gap-1 overflow-auto">
          {shown.map((n) => {
            const selected = resource?.kpNodeId === n.id;
            return (
              <button
                key={n.id} type="button" disabled={busy}
                onClick={() => void save(n.id, n.name)}
                className={`flex items-center justify-between rounded-md border-[1.5px] px-3 py-2 text-left text-[13px] ${
                  selected ? 'border-primary bg-primary-soft font-bold text-primary' : 'border-transparent hover:bg-bg'
                }`}
              >
                <span>{n.name}</span>
                {n.chapter && <small className="ml-3 shrink-0 text-[11.5px] text-ink-3">{n.chapter}{n.section ? ` · ${n.section}` : ''}</small>}
              </button>
            );
          })}
          {nodes.length > 200 && shown.length === 200 && <div className="px-3 py-1.5 text-[11.5px] text-ink-3">只显示前 200 个,请用关键词缩小范围</div>}
        </div>
      )}
    </Modal>
  );
}
