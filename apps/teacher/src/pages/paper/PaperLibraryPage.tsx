/**
 * 试卷库(集中浏览/搜索/复用全机构试卷)
 * 痛点:试卷散在讲次编排的「选择已有卷」弹窗里,没有一站式入口。本页用现成端点拉全部试卷:
 *   GET /papers(按后端上限分页拉全量,客户端按 type 页签 + 试卷名搜索过滤)→ 点卡片 GET /papers/{id} 展开题目。
 * 管理入口:本页直达「独立组卷」——新建 → /papers/new、编辑 → /papers/:id/edit(不依附讲次,只建/改卷);
 *   已被作业引用的卷禁改(后端 4302),编辑入口置灰提示。
 * 引用态为尽力而为:GET /assignments(AssignmentBrief)仅带 paperName,故按试卷名匹配判定。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssignmentBriefDto, PaperDto, QuestionType } from '@qiming/contracts';
import { Button, Card, EmptyState, Skeleton, Tag, TexText } from '@qiming/ui';
import { api } from '../../api';
import { PageHead } from '../Shell';
import {
  PAPER_TABS,
  PAPER_TYPE_LABEL,
  PAPER_TYPE_TONE,
  collectPaperPages,
  countByType,
  filterPapers,
  paperStatusLabel,
  type PaperTab,
} from './lib/paperLibrary';

const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  single: '单选', multi: '多选', blank: '填空', solution: '解答题',
};

export function PaperLibraryPage() {
  const navigate = useNavigate();
  const [papers, setPapers] = useState<PaperDto[]>([]);
  const [referencedNames, setReferencedNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  const [tab, setTab] = useState<PaperTab>('all');
  const [keyword, setKeyword] = useState('');

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailCache, setDetailCache] = useState<Record<number, PaperDto>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [detailErrorId, setDetailErrorId] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(false);
    Promise.all([
      collectPaperPages(async (page, size) => {
        const r = await api.get('/papers', { query: { page, size } });
        return r.data as { items: PaperDto[]; total: number };
      }),
      // 引用态尽力而为;作业拉取失败不阻塞主列表
      api.get('/assignments').catch(() => ({ data: [] as AssignmentBriefDto[] })),
    ])
      .then(([paperItems, ar]) => {
        setPapers(paperItems);
        setReferencedNames(new Set((ar.data as AssignmentBriefDto[]).map((a) => a.paperName)));
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [reload]);

  const shown = useMemo(() => filterPapers(papers, tab, keyword), [papers, tab, keyword]);
  const counts = useMemo(() => countByType(papers), [papers]);

  const loadDetail = (id: number) => {
    setDetailLoadingId(id);
    setDetailErrorId(null);
    api.get('/papers/{id}', { params: { id } })
      .then((r) => setDetailCache((m) => ({ ...m, [id]: r.data as PaperDto })))
      .catch(() => setDetailErrorId(id))
      .finally(() => setDetailLoadingId((cur) => (cur === id ? null : cur)));
  };

  const toggleExpand = (id: number) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!detailCache[id]) loadDetail(id);
  };

  return (
    <div>
      <PageHead
        title="试卷库"
        sub="集中浏览本机构全部试卷,按类型筛选、按名称搜索;点开看题、一键去复用"
        actions={(
          <Button
            variant="primary"
            onClick={() => navigate('/papers/new')}
            title="独立组卷:从题库挑题直接建一份试卷(不依附讲次)"
          >
            + 新建试卷
          </Button>
        )}
      />

      {/* 类型页签(全部 / 随堂练 / 课后作业 / 考试)*/}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PAPER_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-pill border-[1.5px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
              tab === t.key ? 'border-primary bg-primary text-card' : 'border-line bg-card text-ink-2 hover:border-ink-3'
            }`}
          >
            {t.label}
            <span className="ml-1.5 tabular-nums opacity-70">{counts[t.key]}</span>
          </button>
        ))}
        <div className="ml-auto flex w-[260px] items-center gap-2 rounded-[10px] border-[1.5px] border-line bg-card px-3 py-1.5 text-[13px]">
          <span className="text-ink-3">⌕</span>
          <input
            className="w-full bg-transparent text-ink placeholder:text-ink-3 focus:outline-none"
            placeholder="按试卷名搜索…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            aria-label="按试卷名搜索"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState
            icon="⚠"
            text="试卷加载失败"
            hint="可能是网络波动,请重试"
            action={<Button variant="primary" onClick={() => setReload((n) => n + 1)}>重新加载</Button>}
          />
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState
            icon="▥"
            text={keyword.trim() ? '没有匹配的试卷' : '该分类下还没有试卷'}
            hint={keyword.trim() ? '换个关键词,或切换到「全部」' : '点「新建试卷」从题库挑题,直接组一份独立卷'}
            action={!keyword.trim() ? <Button variant="primary" onClick={() => navigate('/papers/new')}>新建试卷</Button> : undefined}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((p) => {
            const referenced = referencedNames.has(p.name);
            const expanded = expandedId === p.id;
            const detail = detailCache[p.id];
            return (
              <Card key={p.id} bodyClassName="p-0">
                {/* 卡片头:类型 / 名称 / 状态 / 题数·总分 / 操作 */}
                <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <Tag tone={PAPER_TYPE_TONE[p.type]}>{PAPER_TYPE_LABEL[p.type]}</Tag>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-sm">{p.name}</b>
                      <Tag tone={p.status === 'published' ? 'green' : 'gray'}>{paperStatusLabel(p.status)}</Tag>
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-ink-2 tabular-nums">
                      {p.questions.length} 题 · 共 {p.totalScore} 分
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {referenced ? (
                      <Button disabled title="该试卷已被作业引用,禁止修改(可在库内新建一份)">编辑</Button>
                    ) : (
                      <Button
                        onClick={() => navigate(`/papers/${p.id}/edit`)}
                        title="独立编辑该试卷(改名/改题/调分)"
                      >
                        编辑
                      </Button>
                    )}
                    <Button variant="primary" onClick={() => toggleExpand(p.id)}>
                      {expanded ? '收起' : '查看详情'}
                    </Button>
                  </div>
                </div>

                {/* 展开:题目列表(GET /papers/{id})*/}
                {expanded && (
                  <div className="border-t border-line bg-bg/40">
                    {detailLoadingId === p.id ? (
                      <div className="px-5 py-4"><Skeleton lines={3} className="h-16 w-full" /></div>
                    ) : detailErrorId === p.id ? (
                      <EmptyState
                        icon="⚠"
                        text="试卷详情加载失败"
                        action={<Button variant="primary" onClick={() => loadDetail(p.id)}>重试</Button>}
                      />
                    ) : detail ? (
                      detail.questions.length === 0 ? (
                        <EmptyState icon="▤" text="该试卷暂无题目" />
                      ) : (
                        detail.questions.map((q) => (
                          <div key={q.seq} className="flex items-start gap-3.5 border-b border-line px-5 py-3.5 last:border-none">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-primary-soft text-[13px] font-bold tabular-nums text-primary">
                              {q.seq}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[13.5px] leading-[1.8]"><TexText src={q.stemLatex} /></div>
                              <div className="mt-1 text-xs text-ink-3">{QUESTION_TYPE_LABEL[q.type]}</div>
                            </div>
                            <div className="shrink-0 text-[12.5px] tabular-nums text-ink-2">{q.score} 分</div>
                          </div>
                        ))
                      )
                    ) : null}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
