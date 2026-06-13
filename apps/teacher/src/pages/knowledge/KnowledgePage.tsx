/**
 * 知识点内容库(C3 #5,核心)
 *
 * 左:教材知识点树(/kp/graphs + /kp/nodes,显示 content 教材正文)。
 * 右:选中知识点 → 维护其「内容包」(GET/PUT /knowledge/content-packs/{kpNodeId}):
 *      挂讲解课件(resource)/ 随堂练卷(practice paper)/ 小结模板(summaryConfig)。
 * 这份内容包被编排页复用:某讲选知识点单元的 kpNode 后,自动按内容包预填讲解/练/小结(可覆盖)。
 * 资源选择可按 kpNode 过滤(ResourceDto.kpNodeId)。
 */
import { useEffect, useMemo, useState } from 'react';
import type { KpContentPackDto, KpGraphDto, KpNodeDto, PaperDto, ResourceDto } from '@qiming/contracts';
import { Button, Card, EmptyState, Modal, Skeleton, Tag, TexText, useToast } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import { filterNodesByKeyword, pickKnowledgeGraph } from './lib/knowledge';

const LINK_CLS = 'text-[13px] font-semibold text-primary hover:underline';

/** 小结模板:个性化巩固题量区间(与编排页 summary.config 同形) */
interface SummaryTpl { min: number; max: number }
function tplFromConfig(config: Record<string, unknown>): SummaryTpl {
  const pc = (config?.personal_consolidation ?? {}) as { min?: unknown; max?: unknown };
  return { min: typeof pc.min === 'number' ? pc.min : 2, max: typeof pc.max === 'number' ? pc.max : 4 };
}
function configFromTpl(t: SummaryTpl): Record<string, unknown> {
  return { personal_consolidation: { min: t.min, max: t.max } };
}

export function KnowledgePage() {
  const { toast } = useToast();
  const [nodes, setNodes] = useState<KpNodeDto[]>([]);
  const [packed, setPacked] = useState<Set<number>>(new Set()); // 已维护内容包的 kpNodeId
  const [resources, setResources] = useState<ResourceDto[]>([]);
  const [papers, setPapers] = useState<PaperDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pack, setPack] = useState<KpContentPackDto | null>(null);
  const [tpl, setTpl] = useState<SummaryTpl>({ min: 2, max: 4 });
  const [packLoading, setPackLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 挂载弹窗:讲解课件 / 随堂练卷 */
  const [mount, setMount] = useState<'lecture' | 'practice' | null>(null);

  const resourceById = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources]);
  const paperById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);

  // 初始:先独立加载教材知识点树(主数据);内容包/资源/卷为次要数据,各自容错,
  // 任一失败都不再拖垮整棵树(此前同放一个 Promise.all,内容包 404 → 整页空)。
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get('/kp/graphs')
      .then(async (g) => {
        const graph = pickKnowledgeGraph(g.data as KpGraphDto[]);
        const n = graph
          ? await api.get('/kp/nodes', { query: { graphId: graph.id } })
          : { data: [] as KpNodeDto[] };
        if (!alive) return;
        const list = n.data as KpNodeDto[];
        setNodes(list);
        if (list[0]) setSelectedId(list[0].id);
        setLoading(false); // 树就绪即渲染,不等次要数据

        // 次要数据:并行、各自 catch,失败仅令对应区缺省,不影响知识点树/搜索
        if (graph) {
          api.get('/knowledge/content-packs', { query: { graphId: graph.id } })
            .then((r) => { if (alive) setPacked(new Set((r.data as KpContentPackDto[]).map((x) => x.kpNodeId))); })
            .catch(() => undefined);
        }
        api.get('/resources', { query: { page: 1, size: 50 } })
          .then((r) => { if (alive) setResources(r.data.items as ResourceDto[]); })
          .catch(() => undefined);
        api.get('/papers', { query: { page: 1, size: 50 } })
          .then((r) => { if (alive) setPapers(r.data.items as PaperDto[]); })
          .catch(() => undefined);
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // 选中知识点 → 拉内容包
  useEffect(() => {
    if (selectedId == null) { setPack(null); return; }
    let alive = true;
    setPackLoading(true);
    setDirty(false);
    api.get('/knowledge/content-packs/{kpNodeId}', { params: { kpNodeId: selectedId } })
      .then((r) => {
        if (!alive) return;
        const p = r.data as KpContentPackDto;
        setPack(p);
        setTpl(tplFromConfig(p.summaryConfig));
      })
      .catch(() => { if (alive) setPack(null); })
      .finally(() => { if (alive) setPackLoading(false); });
    return () => { alive = false; };
  }, [selectedId]);

  const patchPack = (patch: Partial<KpContentPackDto>) => { setPack((p) => (p ? { ...p, ...patch } : p)); setDirty(true); };
  const patchTpl = (patch: Partial<SummaryTpl>) => { setTpl((t) => ({ ...t, ...patch })); setDirty(true); };

  const save = async () => {
    if (!pack || selectedId == null) return;
    setBusy(true);
    try {
      await api.put('/knowledge/content-packs/{kpNodeId}', {
        params: { kpNodeId: selectedId },
        body: {
          lectureResourceId: pack.lectureResourceId,
          practicePaperId: pack.practicePaperId,
          summaryConfig: configFromTpl(tpl),
        },
      });
      // 回读以拿到只读名;标记该知识点已维护
      const r = await api.get('/knowledge/content-packs/{kpNodeId}', { params: { kpNodeId: selectedId } });
      const fresh = r.data as KpContentPackDto;
      setPack(fresh);
      setTpl(tplFromConfig(fresh.summaryConfig));
      setPacked((prev) => new Set(prev).add(selectedId));
      setDirty(false);
      toast('内容包已保存,编排时可自动复用到该知识点单元');
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  // 挂载弹窗候选(讲解=资源,按当前知识点置顶;随堂练=practice 卷)
  const mountItems: { id: number; name: string; meta: string }[] =
    mount === 'lecture'
      ? (selectedId == null ? resources : [...resources.filter((r) => r.kpNodeId === selectedId), ...resources.filter((r) => r.kpNodeId !== selectedId)])
          .map((r) => ({ id: r.id, name: r.name, meta: r.kpNodeId === selectedId ? `${r.type} · 本知识点` : r.type }))
      : mount === 'practice'
        ? papers.filter((p) => p.type === 'practice').map((p) => ({ id: p.id, name: p.name, meta: `${p.questions.length} 题 · ${p.totalScore} 分` }))
        : [];

  if (loading) {
    return (
      <div>
        <Skeleton className="mb-5 h-9 w-2/3" />
        <div className="grid gap-4" style={{ gridTemplateColumns: '320px minmax(0,1fr)' }}>
          <Skeleton lines={6} className="h-80 w-full" />
          <Skeleton lines={5} className="h-80 w-full" />
        </div>
      </div>
    );
  }

  const filtered = filterNodesByKeyword(nodes, keyword);

  return (
    <div>
      <PageHead
        title="知识点内容库"
        sub="按教材知识点沉淀可复用内容:讲解课件 / 随堂练卷 / 小结模板。编排课堂选该知识点时自动预填(可覆盖)"
      />

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: '320px minmax(0,1fr)' }}>
        {/* 左:知识点树 */}
        <div className="rounded-lg border border-line bg-card shadow-card">
          <div className="border-b border-line p-3">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索知识点名称"
              aria-label="搜索知识点"
              className="w-full rounded-[10px] border-[1.5px] border-line px-3 py-2 text-[13px] outline-none focus:border-primary"
            />
          </div>
          {filtered.length === 0 ? (
            <EmptyState icon="▦" text="暂无知识点" hint="教材知识图谱未加载或为空" />
          ) : (
            <div className="flex max-h-[70vh] flex-col overflow-auto p-2">
              {filtered.map((n) => {
                const active = n.id === selectedId;
                return (
                  <button
                    key={n.id} type="button"
                    onClick={() => setSelectedId(n.id)}
                    className={`flex flex-col gap-0.5 rounded-md border-[1.5px] px-3 py-2 text-left transition-colors ${
                      active ? 'border-primary bg-primary-soft' : 'border-transparent hover:bg-bg'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-[13.5px] font-semibold ${active ? 'text-primary' : 'text-ink'}`}>{n.name}</span>
                      {packed.has(n.id) && <Tag tone="green">已建包</Tag>}
                    </div>
                    {n.chapter && <span className="text-[11.5px] text-ink-3">{n.chapter}{n.section ? ` · ${n.section}` : ''}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 右:内容包维护 */}
        {selectedNode == null ? (
          <div className="rounded-lg border border-line bg-card shadow-card">
            <EmptyState icon="📘" text="从左侧选择一个知识点" hint="维护它的讲解 / 随堂练 / 小结内容包" />
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {/* 教材正文 */}
            <Card
              title={(
                <span className="inline-flex items-center gap-2">
                  📘 {selectedNode.name}
                  {dirty && <Tag tone="orange">未保存</Tag>}
                </span>
              )}
              extra={<Button variant="primary" onClick={save} disabled={busy || !dirty || packLoading}>保存内容包</Button>}
            >
              <div className="text-[13.5px] leading-[1.9] text-ink-2">
                {selectedNode.content
                  ? <TexText src={selectedNode.content} />
                  : <span className="text-ink-3">该知识点暂无教材正文(content)</span>}
              </div>
            </Card>

            {packLoading || !pack ? (
              <Skeleton lines={3} className="h-40 w-full" />
            ) : (
              <Card title="内容包" bodyClassName="p-0">
                {/* 讲解课件 */}
                <div className="flex items-center gap-3.5 border-b border-line px-5 py-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-[15px] text-primary">▶</div>
                  <div className="min-w-0 flex-1">
                    <b className="text-[13.5px]">讲解课件</b>
                    <div className="mt-0.5 truncate text-[12.5px] text-ink-2">
                      {pack.lectureResourceId != null
                        ? <>《{resourceById.get(pack.lectureResourceId)?.name ?? pack.lectureResourceName ?? `资源 #${pack.lectureResourceId}`}》</>
                        : <span className="text-ink-3">未挂课件</span>}
                    </div>
                  </div>
                  <button type="button" className={LINK_CLS} onClick={() => setMount('lecture')}>
                    {pack.lectureResourceId != null ? '更换' : '挂载课件'}
                  </button>
                  {pack.lectureResourceId != null && (
                    <button type="button" className="text-[13px] font-medium text-red hover:underline" onClick={() => patchPack({ lectureResourceId: null, lectureResourceName: null })}>移除</button>
                  )}
                </div>

                {/* 随堂练卷 */}
                <div className="flex items-center gap-3.5 border-b border-line px-5 py-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-soft text-[15px] text-violet">✎</div>
                  <div className="min-w-0 flex-1">
                    <b className="text-[13.5px]">随堂练卷</b>
                    <div className="mt-0.5 truncate text-[12.5px] text-ink-2">
                      {pack.practicePaperId != null
                        ? (() => {
                          const p = paperById.get(pack.practicePaperId!);
                          return p
                            ? <>《{p.name}》 · {p.questions.length} 题 · 共 {p.totalScore} 分</>
                            : <>《{pack.practicePaperName ?? `试卷 #${pack.practicePaperId}`}》</>;
                        })()
                        : <span className="text-ink-3">未挂随堂练卷</span>}
                    </div>
                  </div>
                  <button type="button" className={LINK_CLS} onClick={() => setMount('practice')}>
                    {pack.practicePaperId != null ? '更换' : '选择试卷'}
                  </button>
                  {pack.practicePaperId != null && (
                    <button type="button" className="text-[13px] font-medium text-red hover:underline" onClick={() => patchPack({ practicePaperId: null, practicePaperName: null })}>移除</button>
                  )}
                </div>

                {/* 小结模板 */}
                <div className="flex items-center gap-3.5 px-5 py-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-green-soft text-[15px] text-green">◎</div>
                  <div className="min-w-0 flex-1">
                    <b className="text-[13.5px]">小结模板 <span className="rounded-[6px] bg-violet-soft px-1.5 py-px text-[11px] font-bold text-violet">AI</span></b>
                    <div className="mt-0.5 text-[12.5px] text-ink-2">AI 按每位学生本单元错题生成个性化巩固题</div>
                  </div>
                  <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                    题量
                    <input
                      type="number" min={0} max={20} value={tpl.min}
                      onChange={(e) => patchTpl({ min: Math.max(0, Number(e.target.value) || 0) })}
                      aria-label="巩固题量下限"
                      className="w-14 rounded-[8px] border-[1.5px] border-line px-2 py-1 text-center text-[13px] tabular-nums focus:border-primary focus:outline-none"
                    />
                    –
                    <input
                      type="number" min={0} max={20} value={tpl.max}
                      onChange={(e) => patchTpl({ max: Math.max(0, Number(e.target.value) || 0) })}
                      aria-label="巩固题量上限"
                      className="w-14 rounded-[8px] border-[1.5px] border-line px-2 py-1 text-center text-[13px] tabular-nums focus:border-primary focus:outline-none"
                    />
                    道
                  </label>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* 挂载弹窗 */}
      <Modal
        open={mount != null}
        title={mount === 'lecture' ? '挂载讲解课件' : '选择随堂练试卷'}
        onClose={() => setMount(null)}
      >
        {mountItems.length === 0 ? (
          <EmptyState icon="▣" text={mount === 'lecture' ? '资源库暂无课件' : '暂无可用随堂练试卷'} hint="可先到「资源库 / 题库」准备" />
        ) : (
          <div className="flex flex-col gap-2">
            {mountItems.map((it) => {
              const selected = mount === 'lecture' ? pack?.lectureResourceId === it.id : pack?.practicePaperId === it.id;
              return (
                <button
                  key={it.id} type="button"
                  className={`flex items-center justify-between rounded-md border-[1.5px] px-3.5 py-2.5 text-left text-[13.5px] ${
                    selected ? 'border-primary bg-primary-soft font-bold text-primary' : 'border-line hover:border-ink-3'
                  }`}
                  onClick={() => {
                    if (mount === 'lecture') patchPack({ lectureResourceId: it.id, lectureResourceName: it.name });
                    else patchPack({ practicePaperId: it.id, practicePaperName: it.name });
                    setMount(null);
                  }}
                >
                  <span>{it.name}</span>
                  <small className="text-xs text-ink-3">{it.meta}</small>
                </button>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}
