/**
 * 三维标签选择器:弹层内按图谱分 Tab(教材知识点/解题能力/解题策略)勾选节点
 * 数据:/kp/graphs + /kp/nodes(graphId 维度懒加载)
 */
import { useEffect, useMemo, useState } from 'react';
import type { KpGraphDto, KpNodeDto } from '@qiming/contracts';
import { Button, EmptyState, Modal, Skeleton } from '@qiming/ui';
import { api } from '../../../api';
import { GRAPH_LABEL, type TagPick } from '../lib/transform';

export interface TagPickerModalProps {
  open: boolean;
  graphs: KpGraphDto[];
  value: TagPick[];
  onClose: () => void;
  onConfirm: (tags: TagPick[]) => void;
}

export function TagPickerModal({ open, graphs, value, onClose, onConfirm }: TagPickerModalProps) {
  const [activeGraphId, setActiveGraphId] = useState<number | null>(null);
  const [nodesByGraph, setNodesByGraph] = useState<Record<number, KpNodeDto[]>>({});
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [picked, setPicked] = useState<Map<number, TagPick>>(new Map());

  // 打开时重置为当前已选
  useEffect(() => {
    if (!open) return;
    setPicked(new Map(value.map((t) => [t.nodeId, t])));
    setKeyword('');
    if (activeGraphId == null && graphs.length > 0) setActiveGraphId(graphs[0].id);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 懒加载当前 Tab 的节点
  useEffect(() => {
    if (!open || activeGraphId == null || nodesByGraph[activeGraphId]) return;
    setLoading(true);
    api.get('/kp/nodes', { query: { graphId: activeGraphId } })
      .then((r) => setNodesByGraph((m) => ({ ...m, [activeGraphId]: r.data })))
      .finally(() => setLoading(false));
  }, [open, activeGraphId, nodesByGraph]);

  const activeGraph = graphs.find((g) => g.id === activeGraphId);
  const nodes = useMemo(() => {
    const list = activeGraphId != null ? nodesByGraph[activeGraphId] ?? [] : [];
    return keyword ? list.filter((n) => n.name.includes(keyword)) : list;
  }, [activeGraphId, nodesByGraph, keyword]);

  const toggle = (n: KpNodeDto) => {
    if (!activeGraph) return;
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(n.id)) next.delete(n.id);
      else next.set(n.id, { nodeId: n.id, graphType: activeGraph.graphType, code: n.code, name: n.name });
      return next;
    });
  };

  const pickedCount = (graphId: number) => {
    const g = graphs.find((x) => x.id === graphId);
    return g ? [...picked.values()].filter((t) => t.graphType === g.graphType).length : 0;
  };

  return (
    <Modal
      open={open}
      title="三维标注 · 选择图谱节点"
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => onConfirm([...picked.values()])}>
            确定(已选 {picked.size})
          </Button>
        </>
      }
    >
      {/* 图谱 Tab */}
      <div className="mb-3 flex gap-1.5 border-b border-line pb-3">
        {graphs.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setActiveGraphId(g.id)}
            className={`rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
              g.id === activeGraphId ? 'bg-primary text-card' : 'bg-bg text-ink-2 hover:text-ink'
            }`}
          >
            {GRAPH_LABEL[g.graphType]}
            {pickedCount(g.id) > 0 && <span className="ml-1 tabular-nums">· {pickedCount(g.id)}</span>}
          </button>
        ))}
      </div>
      <input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索节点名称…"
        className="mb-3 w-full rounded-[9px] border-[1.5px] border-line px-3 py-2 text-[13px] focus:border-primary focus:outline-none"
      />
      <div className="max-h-[300px] overflow-auto">
        {loading ? (
          <Skeleton lines={5} className="h-8 w-full" />
        ) : nodes.length === 0 ? (
          <EmptyState text="该图谱下没有匹配的节点" className="py-8" />
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {nodes.map((n) => {
              const on = picked.has(n.id);
              return (
                <label
                  key={n.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-[9px] border px-3 py-2 text-[13px] transition-colors ${
                    on ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line text-ink-2 hover:border-ink-3'
                  }`}
                >
                  <input type="checkbox" className="accent-primary" checked={on} onChange={() => toggle(n)} />
                  <span className="min-w-0 flex-1 truncate">{n.name}</span>
                  {n.section && <span className="text-[11px] text-ink-3">{n.section}</span>}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
