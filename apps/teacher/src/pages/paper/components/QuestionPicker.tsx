/**
 * 题库选题弹窗(B3 题库同源数据:仅已入库题)。讲次版与独立版组卷共用。
 * 筛选三层:学科(服务端 subject)→ 知识点(选学科后出现「章节 → 知识点」级联,
 * 选中知识点走服务端 tagNodeId 过滤)→ 关键词(弹窗内客户端过滤)。
 * 目录数据:/kp/graphs + 该学科教材知识点体系的 /kp/nodes(懒加载、按体系缓存)。
 * 选中态由父级 items 决定,点题回调 onToggle 切换。
 */
import { useEffect, useMemo, useState } from 'react';
import type { KpGraphDto, KpNodeDto, QuestionDto } from '@qiming/contracts';
import { Button, EmptyState, Modal, Tag, TexText } from '@qiming/ui';
import { api } from '../../../api';
import { SUBJECTS } from '../../bank/lib/transform';
import { chaptersOf, curriculumGraphForSubject, nodesInChapter } from '../../bank/lib/kpTree';
import { QUESTION_TYPE_LABEL, type PaperItem } from '../lib/paper';
import { DiffDots } from './DiffDots';

const PICKER_SELECT_CLS = 'rounded-[10px] border-[1.5px] border-line bg-card px-3 py-2 text-[13px] focus:border-primary focus:outline-none';

interface QuestionPickerProps {
  open: boolean;
  onClose: () => void;
  /** 题库已入库题(GET /questions?status=published,已按 subject/tagNodeId 服务端过滤) */
  questions: QuestionDto[];
  /** 当前已选,用于标记选中态 */
  items: PaperItem[];
  /** 点题:已选则移除、未选则加入(父级用 toggleQuestion 等实现) */
  onToggle: (q: QuestionDto) => void;
  /** 当前学科筛选('' = 全部);由父级持有,变更触发服务端重新拉题 */
  subject: string;
  /** 切换学科(父级据此重新按学科拉取题库,并重置知识点筛选) */
  onSubjectChange: (subject: string) => void;
  /** 当前知识点筛选(null = 不限);由父级持有,变更触发服务端按 tagNodeId 重新拉题 */
  tagNodeId: number | null;
  /** 选中/清除知识点(父级据此重新拉取题库) */
  onTagNodeChange: (nodeId: number | null) => void;
}

export function QuestionPicker({
  open, onClose, questions, items, onToggle, subject, onSubjectChange, tagNodeId, onTagNodeChange,
}: QuestionPickerProps) {
  const [keyword, setKeyword] = useState('');
  // 知识点级联的目录数据(弹窗自管,懒加载)
  const [graphs, setGraphs] = useState<KpGraphDto[] | null>(null);
  const [nodesByGraph, setNodesByGraph] = useState<Record<number, KpNodeDto[]>>({});
  const [chapter, setChapter] = useState('');

  // 首次打开拉一次知识体系列表
  useEffect(() => {
    if (!open || graphs != null) return;
    api.get('/kp/graphs').then((r) => setGraphs(r.data)).catch(() => setGraphs([]));
  }, [open, graphs]);

  /** 该学科的教材知识点体系(选学科后才有「按知识点筛选」) */
  const curriculumGraph = useMemo(
    () => (subject && graphs ? curriculumGraphForSubject(graphs, subject) : undefined),
    [graphs, subject],
  );

  // 懒加载该体系的节点(按体系缓存,切回不重复请求)
  useEffect(() => {
    if (!open || !curriculumGraph || nodesByGraph[curriculumGraph.id]) return;
    const gid = curriculumGraph.id;
    api.get('/kp/nodes', { query: { graphId: gid } })
      .then((r) => setNodesByGraph((m) => ({ ...m, [gid]: r.data })));
  }, [open, curriculumGraph, nodesByGraph]);

  // 学科变化 → 章节级联复位(知识点筛选由父级 onSubjectChange 一并复位)
  useEffect(() => { setChapter(''); }, [subject]);

  const nodes = curriculumGraph ? nodesByGraph[curriculumGraph.id] ?? [] : [];
  const chapters = useMemo(() => chaptersOf(nodes), [nodes]);
  const nodeOptions = useMemo(() => nodesInChapter(nodes, chapter), [nodes, chapter]);

  const kw = keyword.trim();
  const list = questions.filter(
    (q) => !kw || q.stemLatex.includes(kw) || q.tags.some((t) => t.name.includes(kw)),
  );

  return (
    <Modal
      open={open}
      title="从题库选题"
      onClose={onClose}
      width={720}
      footer={<Button variant="primary" onClick={onClose}>完成选题(已选 {items.length} 题)</Button>}
    >
      <div className="mb-3 flex flex-wrap gap-2.5">
        <select
          className={PICKER_SELECT_CLS}
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          aria-label="学科(选定后可再按知识点筛选)"
        >
          <option value="">全部学科</option>
          {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {subject && curriculumGraph && (
          <>
            <select
              className={PICKER_SELECT_CLS}
              value={chapter}
              onChange={(e) => { setChapter(e.target.value); if (tagNodeId != null) onTagNodeChange(null); }}
              aria-label="教材章节(缩小知识点范围)"
            >
              <option value="">全部章节</option>
              {chapters.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              className={PICKER_SELECT_CLS}
              value={tagNodeId ?? ''}
              onChange={(e) => onTagNodeChange(e.target.value ? Number(e.target.value) : null)}
              aria-label="知识点(选中后只列该知识点下的题)"
            >
              <option value="">全部知识点</option>
              {nodeOptions.map((n) => (
                <option key={n.id} value={n.id}>{n.name}{n.section ? ` · ${n.section}` : ''}</option>
              ))}
            </select>
          </>
        )}
        <input
          className="min-w-[160px] flex-1 rounded-[10px] border-[1.5px] border-line px-3 py-2 text-[13px] focus:border-primary focus:outline-none"
          placeholder="搜索题干 / 知识点"
          aria-label="关键词(匹配题干与知识点标签)"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>
      {!subject && (
        <div className="mb-3 rounded-md bg-bg px-3 py-2 text-xs text-ink-3">
          提示:先选学科,即可再按教材章节 / 知识点精确筛题
        </div>
      )}
      {list.length === 0 ? (
        <EmptyState
          icon="▤"
          text="没有符合条件的已入库题目"
          hint={tagNodeId != null ? '该知识点下暂无入库题,可换个知识点或清除筛选' : '可先到「题库维护」录入并入库新题'}
        />
      ) : (
        <div className="flex max-h-[50vh] flex-col gap-2 overflow-auto pr-1">
          {list.map((q) => {
            const selected = items.some((it) => it.questionId === q.id);
            return (
              <button
                key={q.id} type="button"
                onClick={() => onToggle(q)}
                className={`rounded-md border-[1.5px] px-3.5 py-2.5 text-left ${
                  selected ? 'border-primary bg-primary-soft' : 'border-line hover:border-ink-3'
                }`}
              >
                <div className="flex items-center gap-2 text-xs text-ink-3">
                  <Tag tone={q.type === 'solution' ? 'violet' : 'primary'}>{QUESTION_TYPE_LABEL[q.type]}</Tag>
                  <span className="inline-flex items-center gap-1.5">难度 <DiffDots level={q.difficulty} /></span>
                  {q.stats.correctRate != null && <span className="tabular-nums">正确率 {q.stats.correctRate}%</span>}
                  <span className={`ml-auto font-bold ${selected ? 'text-primary' : 'text-ink-3'}`}>{selected ? '✓ 已选' : '加入'}</span>
                </div>
                <div className="mt-1 text-[13px] leading-[1.7]"><TexText src={q.stemLatex} /></div>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
