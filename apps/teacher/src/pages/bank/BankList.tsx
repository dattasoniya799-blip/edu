/**
 * 题库列表(原型 v0.4 id=t-bank)
 * 左侧筛选:图谱选择 → 年级 → 章节/节点(/kp/graphs /kp/nodes)
 * 右侧题目卡:TexText 题干、难度点、三维标签胶囊、状态;搜索/题型/难度/状态筛选 + 分页
 * 裁剪口径(MVP 手册 1.1):共享库/引用、Word 导入延后不做
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { KpGraphDto, KpNodeDto, QuestionDto, QuestionStatus, QuestionType } from '@qiming/contracts';
import { Button, EmptyState, Skeleton, Tag, TexText, useToast } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import { DIFF_LABEL, GRAPH_LABEL, STATUS_LABEL, TYPE_LABEL, TYPE_TONE, formatDateCn } from './lib/transform';

const PAGE_SIZE = 10;

/** 难度点(原型 .diff:3 格,亮格 = 难度,orange) */
function DiffDots({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-0.5 align-[-1px]">
      {[1, 2, 3].map((i) => (
        <i key={i} className={`h-[7px] w-[7px] rounded-[2px] ${i <= level ? 'bg-orange' : 'bg-line'}`} />
      ))}
    </span>
  );
}

const SELECT_CLS = 'rounded-[10px] border-[1.5px] border-line bg-card px-3 py-2 text-[13px] focus:border-primary focus:outline-none';

export function BankList() {
  const navigate = useNavigate();
  const { toast } = useToast();

  // 左侧:图谱/节点
  const [graphs, setGraphs] = useState<KpGraphDto[]>([]);
  const [graphId, setGraphId] = useState<number | null>(null);
  const [nodes, setNodes] = useState<KpNodeDto[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [grade, setGrade] = useState('');
  const [nodeId, setNodeId] = useState<number | null>(null);

  // 右侧:筛选 + 列表
  const [keyword, setKeyword] = useState('');
  const [debouncedKw, setDebouncedKw] = useState('');
  const [type, setType] = useState<'' | QuestionType>('');
  const [difficulty, setDifficulty] = useState('');
  const [status, setStatus] = useState<'' | QuestionStatus>('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<QuestionDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    api.get('/kp/graphs').then((r) => {
      setGraphs(r.data);
      const curriculum = r.data.find((g) => g.graphType === 'curriculum_knowledge') ?? r.data[0];
      setGraphId(curriculum ? curriculum.id : null);
    }).catch(() => setNodesLoading(false));
  }, []);

  useEffect(() => {
    if (graphId == null) return;
    setNodesLoading(true);
    api.get('/kp/nodes', { query: { graphId } })
      .then((r) => setNodes(r.data))
      .finally(() => setNodesLoading(false));
  }, [graphId]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedKw(keyword.trim()), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  useEffect(() => {
    setLoading(true);
    api.get('/questions', {
      query: {
        page, size: PAGE_SIZE,
        ...(debouncedKw ? { keyword: debouncedKw } : {}),
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        ...(difficulty ? { difficulty: Number(difficulty) } : {}),
        ...(nodeId != null ? { tagNodeId: nodeId } : {}),
      },
    })
      .then((r) => { setItems(r.data.items); setTotal(r.data.total); })
      .finally(() => setLoading(false));
  }, [page, debouncedKw, type, status, difficulty, nodeId, refresh]);

  const grades = useMemo(() => [...new Set(nodes.map((n) => n.grade).filter((g): g is string => !!g))], [nodes]);
  const visibleNodes = useMemo(() => (grade ? nodes.filter((n) => n.grade === grade) : nodes), [nodes, grade]);
  /** 章节(教材图谱)/类目(能力、策略图谱)分组 */
  const nodeGroups = useMemo(() => {
    const map = new Map<string, KpNodeDto[]>();
    for (const n of visibleNodes) {
      const key = n.chapter ?? n.category ?? '其他';
      map.set(key, [...(map.get(key) ?? []), n]);
    }
    return [...map.entries()];
  }, [visibleNodes]);

  const resetPageAnd = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };
  const setNode = resetPageAnd(setNodeId);

  const onDelete = async (q: QuestionDto) => {
    if (!window.confirm(`确认删除该题?\n${q.stemLatex.slice(0, 40)}…`)) return;
    try {
      await api.del('/questions/{id}', { params: { id: q.id } });
      toast('题目已删除');
      setRefresh((n) => n + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败');
    }
  };

  const onPublish = async (q: QuestionDto) => {
    try {
      await api.post('/questions/{id}/publish', { params: { id: q.id } });
      toast('题目已提交入库,可在组卷时使用');
      setRefresh((n) => n + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : '入库失败');
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <PageHead
        title="题库维护"
        sub={`共 ${total} 题 · 全部由教师录入与审核`}
        actions={<Button variant="primary" onClick={() => navigate('/bank/new')}>✎ 录入新题</Button>}
      />
      <div className="grid items-start gap-4" style={{ gridTemplateColumns: '230px 1fr' }}>
        {/* 左:图谱筛选树(原型 .ktree) */}
        <div className="sticky top-[76px] rounded-lg border border-line bg-card p-3.5 shadow-card">
          <div className="mb-3 flex gap-2">
            <select
              className="min-w-0 flex-1 rounded-[9px] border-[1.5px] border-line bg-card px-2 py-1.5 text-[12.5px] focus:border-primary focus:outline-none"
              value={graphId ?? ''}
              onChange={(e) => { setGraphId(Number(e.target.value)); setGrade(''); setNode(null); }}
              aria-label="图谱"
            >
              {graphs.map((g) => <option key={g.id} value={g.id}>{GRAPH_LABEL[g.graphType]}</option>)}
            </select>
            <select
              className="min-w-0 flex-1 rounded-[9px] border-[1.5px] border-line bg-card px-2 py-1.5 text-[12.5px] focus:border-primary focus:outline-none"
              value={grade}
              onChange={(e) => { setGrade(e.target.value); setNode(null); }}
              aria-label="年级"
            >
              <option value="">全部年级</option>
              {grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          {nodesLoading ? (
            <Skeleton lines={6} className="h-7 w-full" />
          ) : (
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => setNode(null)}
                className={`flex items-center justify-between rounded-lg px-2.5 py-[7px] text-left text-[13px] ${
                  nodeId == null ? 'bg-primary-soft font-bold text-primary' : 'text-ink-2 hover:bg-bg'
                }`}
              >
                全部题目
              </button>
              {nodeGroups.length === 0 && <div className="px-2.5 py-2 text-xs text-ink-3">该图谱暂无节点</div>}
              {nodeGroups.map(([group, list]) => (
                <div key={group}>
                  <div className="truncate px-2.5 pb-1 pt-2.5 text-[11px] font-semibold tracking-wide text-ink-3">{group}</div>
                  {list.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setNode(nodeId === n.id ? null : n.id)}
                      className={`flex w-full items-center justify-between rounded-lg py-[7px] pl-6 pr-2.5 text-left text-[13px] ${
                        nodeId === n.id ? 'bg-primary-soft font-bold text-primary' : 'text-ink-2 hover:bg-bg'
                      }`}
                    >
                      <span className="truncate">{n.name}</span>
                      {n.section && <small className="text-[11px] text-ink-3">{n.section}</small>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右:题目卡列表 */}
        <div className="rounded-lg border border-line bg-card shadow-card">
          <div className="flex flex-wrap gap-2.5 border-b border-line px-4 py-3.5">
            <input
              className="w-[200px] rounded-[10px] border-[1.5px] border-line px-3 py-2 text-[13px] focus:border-primary focus:outline-none"
              placeholder="搜索题干 / 知识点"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
            />
            <select className={SELECT_CLS} value={type} onChange={(e) => { setType(e.target.value as '' | QuestionType); setPage(1); }} aria-label="题型">
              <option value="">全部题型</option>
              {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
            <select className={SELECT_CLS} value={difficulty} onChange={(e) => { setDifficulty(e.target.value); setPage(1); }} aria-label="难度">
              <option value="">全部难度</option>
              {[1, 2, 3].map((d) => <option key={d} value={d}>{DIFF_LABEL[d]}</option>)}
            </select>
            <select className={SELECT_CLS} value={status} onChange={(e) => { setStatus(e.target.value as '' | QuestionStatus); setPage(1); }} aria-label="状态">
              <option value="">全部状态</option>
              <option value="published">已入库</option>
              <option value="draft">草稿</option>
            </select>
          </div>

          {loading ? (
            <div className="space-y-3 p-5"><Skeleton lines={4} className="h-20 w-full" /></div>
          ) : items.length === 0 ? (
            <EmptyState
              text="没有符合条件的题目"
              hint="调整左侧图谱筛选或右上角条件,或点击「录入新题」开始建设题库"
              action={<Button variant="primary" onClick={() => navigate('/bank/new')}>✎ 录入新题</Button>}
            />
          ) : (
            <>
              {items.map((q) => (
                <div key={q.id} className="border-b border-line px-5 py-4 last:border-none">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Tag tone={TYPE_TONE[q.type]}>{TYPE_LABEL[q.type]}</Tag>
                    {q.tags.filter((t) => t.graphType === 'curriculum_knowledge').map((t) => (
                      <Tag key={t.nodeId}>{(q.chapter ? `${q.chapter.replace(/^第.+章\s*/, '')} · ` : '') + t.name}</Tag>
                    ))}
                    {q.tags.filter((t) => t.graphType === 'problem_solving_ability').map((t) => (
                      <Tag key={t.nodeId} tone="violet">{t.name}</Tag>
                    ))}
                    {q.tags.filter((t) => t.graphType === 'problem_solving_strategy').map((t) => (
                      <Tag key={t.nodeId} tone="orange">{t.name}</Tag>
                    ))}
                    {q.figures.length > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary-soft px-2 py-0.5 text-[11.5px] text-primary">
                        ⛶ 含 {q.figures.length} 张图
                      </span>
                    )}
                    {q.status !== 'published' && (
                      <Tag tone={q.status === 'draft' ? 'orange' : 'red'}>{STATUS_LABEL[q.status]}</Tag>
                    )}
                  </div>
                  <div className="text-sm leading-[1.8]"><TexText src={q.stemLatex} /></div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-4 text-xs text-ink-3">
                    <span className="inline-flex items-center gap-1.5">难度 <DiffDots level={q.difficulty} /></span>
                    <span className="tabular-nums">正确率 {q.stats.correctRate != null ? `${q.stats.correctRate}%` : '—'}</span>
                    <span className="tabular-nums">组卷 {q.stats.usedInPapers} 次</span>
                    <span>录入:{q.ownerName} · {formatDateCn(q.createdAt)}</span>
                    <span className="ml-auto flex gap-3.5">
                      <button type="button" className="text-[13px] font-semibold text-primary" onClick={() => navigate(`/bank/${q.id}/edit`)}>编辑</button>
                      {q.status === 'draft' && (
                        <button type="button" className="text-[13px] font-semibold text-primary" onClick={() => onPublish(q)}>入库</button>
                      )}
                      <button type="button" className="text-[13px] font-semibold text-red" onClick={() => onDelete(q)}>删除</button>
                    </span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-3 text-[12.5px] text-ink-2">
                <span className="tabular-nums">第 {from}-{to} 条,共 {total} 条</span>
                <div className="flex gap-1.5">
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={`h-7 w-7 rounded-lg border text-[12.5px] tabular-nums ${
                        p === page ? 'border-primary bg-primary text-card' : 'border-line text-ink-2 hover:border-ink-3'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
