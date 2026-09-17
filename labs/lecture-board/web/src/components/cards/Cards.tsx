/**
 * 9 种卡片:heading / points / board / table / figure / animation / problem / analysis / takeaways。
 * 纪律(protocol.md「画布底座」):**本目录不得 import excalidraw**,只吃剧本数据。
 */
import type { ReactNode } from 'react';
import { Fragment } from 'react';
import { useBoard } from '../../board-context';
import { TAKEAWAY_GROUPS, TAKEAWAY_GROUP_TITLE } from '../../lib/audio-keys';
import { takeawayTarget } from '../../lib/flow';
import { highlightClass } from '../../lib/highlight';
import { mdToHtml } from '../../lib/markdown';
import {
  analysisTarget,
  hasAnalysisStep,
  isAnalysisBlockRevealed,
  isAnalysisItemRevealed,
  isMarkRevealed,
  markTarget,
  type AnalysisBlock,
} from '../../lib/targets';
import type { BoardScript, Card, TakeawayGroup } from '../../types';
import { CardBody, MarkerTitle } from '../CardBody';
import { Tex } from '../Katex';
import { AnimationCard } from './AnimationCard';
import { FigureCard } from './FigureCard';

/** 拼 className,跳过空串(整卡「正在讲/留痕」样式贴在每种卡的最外层 data-fx-target div 上)。 */
function cx(...parts: Array<string | false | undefined>): string | undefined {
  const s = parts.filter(Boolean).join(' ');
  return s || undefined;
}

export function CardView({ card }: { card: Card }) {
  const { script, speaking, kept } = useBoard();
  const cardHl = highlightClass(card.id, speaking, kept, 'card');
  switch (card.kind) {
    case 'heading':
      return (
        <CardBody className="card-heading">
          <div data-fx-target={card.id} className={cardHl}>
            <span>{card.text}</span>
          </div>
        </CardBody>
      );
    case 'points':
      return (
        <CardBody>
          <div data-fx-target={card.id} className={cardHl}>
            {card.title && <MarkerTitle>{card.title}</MarkerTitle>}
            {card.lines.map((l, i) => (
              <div className="points-line" key={i}>
                <span className="bullet">·</span>
                <span>{l}</span>
              </div>
            ))}
          </div>
        </CardBody>
      );
    case 'board':
      return <BoardCard card={card} cardHl={cardHl} />;
    case 'table':
      return (
        <CardBody>
          <div data-fx-target={card.id} className={cardHl}>
            {card.title && <MarkerTitle>{card.title}</MarkerTitle>}
            <div className="board-md" dangerouslySetInnerHTML={{ __html: mdToHtml(card.markdown) }} />
          </div>
        </CardBody>
      );
    case 'figure':
      return (
        <CardBody>
          <div data-fx-target={card.id} className={cardHl}>
            <FigureCard figure={script.figures?.find((f) => f.id === card.figureId)} />
          </div>
        </CardBody>
      );
    case 'animation': {
      const anim = script.animations?.find((a) => a.id === card.animationId);
      if (!anim) return null;
      return (
        <CardBody>
          <div data-fx-target={card.id} className={cardHl}>
            <AnimationCard anim={anim} />
          </div>
        </CardBody>
      );
    }
    case 'problem':
      return <ProblemCard cardId={card.id} cardHl={cardHl} />;
    case 'analysis':
      return <AnalysisCard cardId={card.id} cardHl={cardHl} />;
    case 'takeaways':
      return <TakeawaysCard cardId={card.id} cardHl={cardHl} />;
  }
}

/* ----------------------------- board ----------------------------- */

function BoardCard({ card, cardHl }: { card: Extract<Card, { kind: 'board' }>; cardHl?: string }) {
  const { revealed, speaking, kept } = useBoard();
  return (
    <CardBody>
      <div data-fx-target={card.id} className={cardHl}>
        {card.title && <MarkerTitle>{card.title}</MarkerTitle>}
        {card.lines.map((line) => {
          if (!revealed.has(line.id)) return null;
          const hl = highlightClass(line.id, speaking, kept, 'mark');
          return (
            <div
              key={line.id}
              className={cx('board-line', `kind-${line.kind}`, 'line-in', hl)}
              data-fx-target={line.id}
            >
              {line.kind === 'formula' && line.tex ? <Tex tex={line.tex} /> : line.text}
            </div>
          );
        })}
      </div>
    </CardBody>
  );
}

/* ---------------------------- problem ---------------------------- */

/**
 * analysis.marks 必须是 problem.text 的子串;同位置取最长的 mark(与 lecture-scene 播放器一致)。
 * 每个 mark 片段**始终**渲染一个 `data-fx-target="mark:<text>"` 的 span(文字照常显示),
 * 只在该 mark 已 reveal(或旧剧本/无 analysis step)时才上三色底——审题列新初态的核心(schema.ts Card 注释)。
 * speaking/kept 决定这个 span 要不要再叠一层「正在讲/留痕」的黄色马克笔底。
 */
export function highlightMarks(
  text: string,
  marks: BoardScript['analysis']['marks'],
  revealed: ReadonlySet<string> = new Set(),
  analysisDriven = false,
  speaking: ReadonlySet<string> = new Set(),
  kept: ReadonlyMap<string, 'mark' | 'circle'> = new Map(),
): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest.length) {
    let best: { idx: number; mark: (typeof marks)[number] } | null = null;
    for (const m of marks) {
      if (!m?.text) continue;
      const idx = rest.indexOf(m.text);
      if (idx < 0) continue;
      if (!best || idx < best.idx || (idx === best.idx && m.text.length > best.mark.text.length)) {
        best = { idx, mark: m };
      }
    }
    if (!best) {
      out.push(<Fragment key={n++}>{rest}</Fragment>);
      break;
    }
    if (best.idx > 0) out.push(<Fragment key={n++}>{rest.slice(0, best.idx)}</Fragment>);
    const target = markTarget(best.mark.text);
    const shown = isMarkRevealed(revealed, best.mark.text, analysisDriven);
    out.push(
      <span
        key={n++}
        data-fx-target={target}
        className={cx(shown && `mark-${best.mark.kind}`, highlightClass(target, speaking, kept, 'mark'))}
      >
        {best.mark.text}
      </span>,
    );
    rest = rest.slice(best.idx + best.mark.text.length);
  }
  return out;
}

function ProblemCard({ cardId, cardHl }: { cardId: string; cardHl?: string }) {
  const { script, revealed, speaking, kept } = useBoard();
  const marks = script.analysis?.marks ?? [];
  const analysisDriven = hasAnalysisStep(script);
  const lines = script.problem.text.split('\n').filter((l) => l.trim().length > 0);
  return (
    <CardBody>
      <div data-fx-target={cardId} className={cardHl}>
        <div className="problem-legend">
          <span className="legend-key">限制/关键</span>
          <span className="legend-data">数据</span>
          <span className="legend-hidden">隐含线索</span>
        </div>
        {lines.map((line, i) => (
          <div className="problem-line" key={i}>
            {highlightMarks(line, marks, revealed, analysisDriven, speaking, kept)}
          </div>
        ))}
        {script.problem.images?.length > 0 && (
          <div className="problem-images">
            {script.problem.images.map((src) => (
              <img key={src} src={src} alt="题图" />
            ))}
          </div>
        )}
      </div>
    </CardBody>
  );
}

/* ---------------------------- analysis ---------------------------- */

function AnalysisCard({ cardId, cardHl }: { cardId: string; cardHl?: string }) {
  const { script, revealed, speaking, kept } = useBoard();
  const a = script.analysis;
  const analysisDriven = hasAnalysisStep(script);
  const blocks: { block: AnalysisBlock; title: string; cls: string; items: string[] }[] = [
    { block: 'given' as const, title: '已知', cls: 'is-given', items: a?.given ?? [] },
    { block: 'hidden' as const, title: '隐含条件', cls: 'is-hidden', items: a?.hidden ?? [] },
    { block: 'find' as const, title: '求什么', cls: 'is-find', items: a?.find ?? [] },
    { block: 'ideas' as const, title: '思路切入', cls: 'is-ideas', items: a?.ideas ?? [] },
  ].filter((b) => b.items.length > 0);
  return (
    <CardBody>
      <div data-fx-target={cardId} className={cardHl}>
        <MarkerTitle>审题</MarkerTitle>
        <div className="analysis-grid">
          {blocks.map((b) => {
            // 审题列新初态:块本身要等 reveal(整块或块里任一条)才出现,旧剧本(无 analysis step)恒可见
            if (!isAnalysisBlockRevealed(revealed, b.block, analysisDriven, b.items.length)) return null;
            const blockTarget = analysisTarget(b.block);
            return (
              <div
                className={cx('analysis-block', b.cls, highlightClass(blockTarget, speaking, kept, 'mark'))}
                key={b.title}
                data-fx-target={blockTarget}
              >
                <div className="ab-title">{b.title}</div>
                {b.items.map((it, i) => {
                  if (!isAnalysisItemRevealed(revealed, b.block, i, analysisDriven)) return null;
                  const itemTarget = analysisTarget(b.block, i);
                  return (
                    <div
                      className={cx('ab-item', 'line-in', highlightClass(itemTarget, speaking, kept, 'mark'))}
                      key={i}
                      data-fx-target={itemTarget}
                    >
                      <span>·</span>
                      <span>{it}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </CardBody>
  );
}

/* ---------------------------- takeaways ---------------------------- */

/** 【关键词】渲染为该组主色胶囊,不显示括号本身。 */
export function renderAccented(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  for (;;) {
    const a = rest.indexOf('【');
    const b = a >= 0 ? rest.indexOf('】', a + 1) : -1;
    if (a < 0 || b < 0) {
      if (rest) out.push(<Fragment key={n++}>{rest}</Fragment>);
      break;
    }
    if (a > 0) out.push(<Fragment key={n++}>{rest.slice(0, a)}</Fragment>);
    out.push(
      <span key={n++} className="accent-pill">
        {rest.slice(a + 1, b)}
      </span>,
    );
    rest = rest.slice(b + 1);
  }
  return out;
}

function TakeawaysCard({ cardId, cardHl }: { cardId: string; cardHl?: string }) {
  const { script, revealed, speaking, kept } = useBoard();
  const t = script.takeaways;
  // 两种驱动方式都要认:flow 里逐条 reveal `takeaway:<组>:<i>`(协议的总结环节),
  // 或者剧本直接 `reveal` 整张卡(真剧本就是这么写的)—— 后者整卡一次显示完。
  const wholeCard = revealed.has(cardId);
  return (
    <CardBody>
      <div data-fx-target={cardId} className={cardHl}>
        <MarkerTitle>这道题带走什么</MarkerTitle>
        {TAKEAWAY_GROUPS.map((g: TakeawayGroup) => {
          const items = t?.[g] ?? [];
          const shown = items
            .map((it, i) => ({ it, i }))
            .filter(({ i }) => wholeCard || revealed.has(takeawayTarget(g, i)));
          if (!shown.length) return null;
          return (
            <div className={`takeaway-block is-${g}`} key={g}>
              <div className="tb-title">{TAKEAWAY_GROUP_TITLE[g]}</div>
              {shown.map(({ it, i }) => {
                const target = takeawayTarget(g, i);
                return (
                  <div
                    className={cx('takeaway-item', 'line-in', highlightClass(target, speaking, kept, 'mark'))}
                    key={i}
                    data-fx-target={target}
                  >
                    <span className="idx">{i + 1}.</span>
                    <span>{renderAccented(it)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </CardBody>
  );
}

/** 动手环节卡(explore 列没有 cards[],由适配层合成一张)。 */
export function ExploreCard() {
  const { explore, script } = useBoard();
  if (!explore) return null;
  const anim = script.animations?.find((a) => a.id === explore.animationId);
  return (
    <CardBody>
      <div data-fx-target="explore">
        <MarkerTitle>动手试试</MarkerTitle>
        <div className="explore-box">
          <div className="explore-title">
            {anim ? `「${anim.purpose}」那张动画卡已解锁:${explore.unlock.join(' / ')}` : '动画卡已解锁'}
          </div>
          {explore.tasks.map((task, i) => (
            <div className="explore-task" key={i}>
              <span>○</span>
              <span>{task}</span>
            </div>
          ))}
        </div>
      </div>
    </CardBody>
  );
}
