/**
 * 三维标签选择器:弹层内按图谱分 Tab(教材知识点/解题能力/解题策略)勾选节点
 * 数据:/kp/graphs + /kp/nodes(graphId 维度懒加载)
 * 多学科图谱并存后:传入 subject 时只展示该学科的图谱(无匹配则回退全部);
 * 跨学科展示时 Tab 名带学科前缀,避免多张"教材知识点"无法区分。
 * 辅助查询:搜索匹配 name/chapter/section,结果按章节分组展示(章标题 + 其下节点)。
 */
import { useEffect, useMemo, useState } from 'react';
import type { KpGraphDto, KpNodeDto } from '@qiming/contracts';
import { Button, EmptyState, Modal, Skeleton } from '@qiming/ui';
import { api } from '../../../api';
import { GRAPH_LABEL, graphLabel, type TagPick } from '../lib/transform';
import { filterAndGroupNodes } from '../lib/kpTree';

export interface TagPickerModalProps {
  open: boolean;
  graphs: KpGraphDto[];
  /** 题目学科:只展示该学科的图谱(无匹配图谱时回退展示全部) */
  subject?: string;
  value: TagPick[];
  onClose: () => void;
  onConfirm: (tags: TagPick[]) => void;
}

export function TagPickerModal({ open, graphs, subject, value, onClose, onConfirm }: TagPickerModalProps) {
  const [activeGraphId, setActiveGraphId] = useState<number | null>(null);
  const [nodesByGraph, setNodesByGraph] = useState<Record<number, KpNodeDto[]>>({});
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [picked, setPicked] = useState<Map<number, TagPick>>(new Map());

  const shownGraphs = useMemo(() => {
    const bySubject = subject ? graphs.filter((g) => g.subject === subject) : graphs;
    return bySubject.length > 0 ? bySubject : graphs;
  }, [graphs, subject]);
  const multiSubject = useMemo(() => new Set(shownGraphs.map((g) => g.subject)).size > 1, [shownGraphs]);

  // 打开时重置为当前已选;当前 Tab 不在展示范围(如切换了题目学科)则跳到首个可见图谱
  useEffect(() => {
    if (!open) return;
    setPicked(new Map(value.map((t) => [t.nodeId, t])));
    setKeyword('');
    if (shownGraphs.length > 0 && !shownGraphs.some((g) => g.id === activeGraphId))
      setActiveGraphId(shownGraphs[0].id);
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
  /** 搜索(name/chapter/section)+ 按章节/类目分组:找知识点时先见章、再见节点 */
  const nodeGroups = useMemo(() => {
    const list = activeGraphId != null ? nodesByGraph[activeGraphId] ?? [] : [];
    return filterAndGroupNodes(list, keyword);
  }, [activeGraphId, nodesByGraph, keyword]);
  const matchCount = useMemo(() => nodeGroups.reduce((s, [, list]) => s + list.length, 0), [nodeGroups]);

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
      <div className="mb-3 flex flex-wrap gap-1.5 border-b border-line pb-3">
        {shownGraphs.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setActiveGraphId(g.id)}
            className={`rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
              g.id === activeGraphId ? 'bg-primary text-card' : 'bg-bg text-ink-2 hover:text-ink'
            }`}
          >
            {multiSubject ? graphLabel(g) : GRAPH_LABEL[g.graphType]}
            {pickedCount(g.id) > 0 && <span className="ml-1 tabular-nums">· {pickedCount(g.id)}</span>}
          </button>
        ))}
      </div>
      <input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索知识点 / 章节 / 小节…"
        aria-label="搜索知识点(匹配名称、章节、小节)"
        className="mb-3 w-full rounded-[9px] border-[1.5px] border-line px-3 py-2 text-[13px] focus:border-primary focus:outline-none"
      />
      <div className="max-h-[300px] overflow-auto">
        {loading ? (
          <Skeleton lines={5} className="h-8 w-full" />
        ) : matchCount === 0 ? (
          <EmptyState text="该图谱下没有匹配的节点" hint="试试换个关键词,或搜章节名(如「一次函数」)" className="py-8" />
        ) : (
          nodeGroups.map(([group, list]) => (
            <div key={group} className="mb-2">
              <div className="truncate px-0.5 pb-1 pt-1 text-[11px] font-semibold tracking-wide text-ink-3">{group}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {list.map((n) => {
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
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
