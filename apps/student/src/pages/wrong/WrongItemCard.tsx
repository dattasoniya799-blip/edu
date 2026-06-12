/**
 * 错题卡(展示组件,原型 s-wrong 段):题型/错次/错因标签 + 题干 + 重做/看解析(折叠)
 * 数学内容 TexText;可点目标 ≥44px
 */
import { useState } from 'react';
import type { WrongBookItemDto } from '@qiming/contracts';
import { Button, Tag, TexText } from '@qiming/ui';

const TYPE_LABEL: Record<string, string> = { single: '单选题', multi: '多选题', blank: '填空题', solution: '解答题' };

export interface WrongItemCardProps {
  item: WrongBookItemDto;
  onRedo: (id: number) => void;
  redoing?: boolean;
}

export function WrongItemCard({ item, onRedo, redoing }: WrongItemCardProps) {
  const [expanded, setExpanded] = useState(false);
  const cleared = item.status === 'cleared';

  return (
    <div className={`rounded-lg border border-line bg-card p-5 shadow-card ${cleared ? 'opacity-70' : ''}`}>
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <Tag tone={item.type === 'solution' ? 'green' : 'primary'}>{TYPE_LABEL[item.type] ?? item.type}</Tag>
        <Tag tone="red">错 {item.wrongCount} 次</Tag>
        {item.errorTags.map((t) => <Tag key={t} tone="orange">{t}</Tag>)}
        {cleared ? (
          <Tag tone="green">已消灭 ✓</Tag>
        ) : item.correctRedoCount > 0 ? (
          <Tag tone="green">已订正 {item.correctRedoCount}/2 次</Tag>
        ) : null}
        <span className="ml-auto text-xs text-ink-3">
          {item.sourceName} · {new Date(item.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
        </span>
      </div>

      <div className="text-sm leading-7 text-ink"><TexText src={item.stemLatex} /></div>

      <div className="mt-3 flex flex-wrap gap-2">
        {!cleared && (
          <Button variant="primary" className="min-h-touch" disabled={redoing} onClick={() => onRedo(item.id)}>
            重做本题
          </Button>
        )}
        {item.analysisLatex && (
          <Button className="min-h-touch" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起解析' : '看解析'}
          </Button>
        )}
      </div>

      {expanded && item.analysisLatex && (
        <div className="mt-3 rounded-md bg-bg/60 p-3.5 text-[13px] leading-7 text-ink-2">
          <b className="mr-1 text-ink">解析</b>
          <TexText src={item.analysisLatex} />
        </div>
      )}
    </div>
  );
}
