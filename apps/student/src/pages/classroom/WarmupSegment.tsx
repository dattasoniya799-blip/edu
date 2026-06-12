/**
 * 环节① 开场回顾(原型 s-class-warm):错题卡列表(warmup.config source=auto_wrong)
 * 数据 = REST /student/wrong-book(open)前 count 道(取数在 ClassroomPage,本组件纯展示)
 */
import type { WrongBookItemDto } from '@qiming/contracts';
import { Button, EmptyState, Skeleton, Tag, TexText } from '@qiming/ui';

export interface WarmupSegmentProps {
  /** null = 加载中 */
  items: WrongBookItemDto[] | null;
  /** 已点「标记已回顾」的错题 id */
  reviewed: number[];
  onReview(id: number): void;
  onNext(): void;
}

export function WarmupSegment({ items, reviewed, onReview, onNext }: WarmupSegmentProps) {
  return (
    <div className="mx-auto max-w-[860px]">
      <div className="mb-3.5 flex items-start gap-2.5 rounded-md bg-gradient-to-r from-violet to-primary p-3.5 text-[13px] leading-6 text-card">
        <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-card/25 text-[13px]">✦</span>
        <span>小启:上课啦!先热个身——这几道是之前你错过的题,我们一起过一遍,准备好了就进入新课。</span>
      </div>

      {items == null ? (
        <Skeleton className="h-40" lines={3} />
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-line bg-card p-8 shadow-card">
          <EmptyState icon="✓" text="没有待回顾的错题" hint="直接进入新课吧" />
        </div>
      ) : (
        items.map((w, i) => {
          const done = reviewed.includes(w.id);
          const last = !done && i === items.length - 1;
          return (
            <div key={w.id}
              className={`mb-3 flex items-start gap-3.5 rounded-lg border bg-card p-4 shadow-card ${last ? 'border-2 border-orange' : 'border-line'}`}>
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-orange-soft text-[13px] font-extrabold text-orange">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm leading-8"><TexText src={w.stemLatex} /></div>
                <small className="mt-1 block text-xs text-ink-3">
                  错 {w.wrongCount} 次 · 来源:{w.sourceName}
                  {w.errorTags.length > 0 && ` · 错因:${w.errorTags.join('、')}`}
                </small>
                {!done && w.analysisLatex && (
                  <div className="mt-2 rounded-md bg-bg/70 px-3 py-2 text-xs leading-6 text-ink-2">
                    <b className="mr-1 text-ink">回顾要点</b><TexText src={w.analysisLatex} />
                  </div>
                )}
              </div>
              {done ? (
                <Tag tone="green" className="shrink-0">已回顾</Tag>
              ) : (
                <Button className="min-h-touch shrink-0" onClick={() => onReview(w.id)}>标记已回顾</Button>
              )}
            </div>
          );
        })
      )}

      <div className="mt-4 flex justify-end">
        <Button variant="primary" className="min-h-touch min-w-[200px]" onClick={onNext}>
          热身完成,进入新课 →
        </Button>
      </div>
    </div>
  );
}
