/**
 * 题库选题弹窗(B3 题库同源数据:仅已入库题)。讲次版与独立版组卷共用。
 * 关键词搜索在弹窗内部自管;选中态由父级 items 决定,点题回调 onToggle 切换。
 */
import { useState } from 'react';
import type { QuestionDto } from '@qiming/contracts';
import { Button, EmptyState, Modal, Tag, TexText } from '@qiming/ui';
import { SUBJECTS } from '../../bank/lib/transform';
import { QUESTION_TYPE_LABEL, type PaperItem } from '../lib/paper';
import { DiffDots } from './DiffDots';

const PICKER_SELECT_CLS = 'rounded-[10px] border-[1.5px] border-line bg-card px-3 py-2 text-[13px] focus:border-primary focus:outline-none';

interface QuestionPickerProps {
  open: boolean;
  onClose: () => void;
  /** 题库已入库题(GET /questions?status=published,已按 subject 服务端过滤) */
  questions: QuestionDto[];
  /** 当前已选,用于标记选中态 */
  items: PaperItem[];
  /** 点题:已选则移除、未选则加入(父级用 toggleQuestion 等实现) */
  onToggle: (q: QuestionDto) => void;
  /** 当前学科筛选('' = 全部);由父级持有,变更触发服务端重新拉题 */
  subject: string;
  /** 切换学科(父级据此重新按学科拉取题库) */
  onSubjectChange: (subject: string) => void;
}

export function QuestionPicker({ open, onClose, questions, items, onToggle, subject, onSubjectChange }: QuestionPickerProps) {
  const [keyword, setKeyword] = useState('');
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
      <div className="mb-3 flex gap-2.5">
        <select
          className={PICKER_SELECT_CLS}
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          aria-label="学科"
        >
          <option value="">全部学科</option>
          {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          className="min-w-0 flex-1 rounded-[10px] border-[1.5px] border-line px-3 py-2 text-[13px] focus:border-primary focus:outline-none"
          placeholder="搜索题干 / 知识点"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>
      {list.length === 0 ? (
        <EmptyState icon="▤" text="没有符合条件的已入库题目" hint="可先到「题库维护」录入并入库新题" />
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
