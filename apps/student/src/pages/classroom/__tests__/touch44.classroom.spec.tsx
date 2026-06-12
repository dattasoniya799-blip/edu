// @vitest-environment jsdom
/**
 * 课堂模式 44px 断言(沿用 B5 touch44 模式):
 * jsdom 渲染课堂各环节组件 → 所有可点目标必须带 min-h-touch;
 * 源码扫描兜底:classroom 目录所有 <Button/<button 显式写 min-h-touch。
 * 附带:四环节组件均可渲染(组件级冒烟)+ 数学内容出 KaTeX。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WrongBookItemDto } from '@qiming/contracts';
import { ToastProvider } from '@qiming/ui';
import { CLASS_COURSEWARE, CLASS_LESSON_TITLE, CLASS_MODE, CLASS_QUESTIONS, CLASS_SEGMENTS, CLASS_SESSION_ID, NARRATION_PRE_GRADE } from '../../../mocks/class-data';
import { ClassFoot } from '../ClassFoot';
import { ClassHead } from '../ClassHead';
import { LectureSegment } from '../LectureSegment';
import { initialClassState, reduceClass } from '../machine';
import { PracticeSegment, PreGradeCard } from '../PracticeSegment';
import { SummarySegment } from '../SummarySegment';
import { TutorPanel } from '../TutorPanel';
import type { ClassJoinSnapshot } from '../types';
import { WarmupSegment } from '../WarmupSegment';

// ---------------- 夹具 ----------------
const snap: ClassJoinSnapshot = {
  session: {
    id: CLASS_SESSION_ID, status: 'live', lessonTitle: CLASS_LESSON_TITLE,
    segments: CLASS_SEGMENTS, currentSegmentSeq: 1, elapsedSec: 3138, mode: CLASS_MODE,
  },
  me: { segment: 3, currentQuestion: null, answers: [{ questionId: 1, isCorrect: true, score: 5 }], wrongBookAdded: [], aiChatTail: [] },
  questions: CLASS_QUESTIONS,
  courseware: CLASS_COURSEWARE,
};
const joined = reduceClass(initialClassState, { type: 'snapshot', snap, resumed: false });

const wrongItems: WrongBookItemDto[] = [1, 2, 3].map((i) => ({
  id: i, questionId: i, type: 'single',
  stemLatex: `直线 $y=3x-${i}$ 与 $y$ 轴的交点坐标是 ________。`,
  analysisLatex: '令 $x=0$,交点为 $(0, b)$。',
  wrongCount: i, correctRedoCount: 0, errorTags: ['图象平移符号'], status: 'open',
  sourceName: '第3讲课后作业', createdAt: '2026-06-07T10:30:00.000Z',
}));

const noop = () => undefined;
const asyncNoop = () => Promise.resolve();

function mount(node: Parameters<typeof renderToStaticMarkup>[0]): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<ToastProvider>{node}</ToastProvider>);
  document.body.appendChild(host);
  return host;
}

function assertTouch44(host: HTMLElement, what: string): void {
  const targets = host.querySelectorAll<HTMLElement>('button, label[for], [role="button"], input:not([type="hidden"]):not([type="file"])');
  expect(targets.length, `${what}:应至少有一个可点目标`).toBeGreaterThan(0);
  for (const el of targets) {
    expect(el.className, `${what}:<${el.tagName.toLowerCase()}> "${el.textContent?.slice(0, 18)}" 缺 min-h-touch(44px)`).toMatch(/\bmin-h-touch\b/);
  }
}

// ---------------- 44px + 组件级渲染冒烟 ----------------
describe('课堂模式可点目标 ≥44px(min-h-touch)', () => {
  it('深色头部:退出 + 可点步进器(四环节)', () => {
    const host = mount(
      <ClassHead title={CLASS_LESSON_TITLE} segments={CLASS_SEGMENTS} seg={2}
        elapsedSec={100} reconnectAttempt={0} onStep={noop} onExit={noop} />,
    );
    assertTouch44(host, 'class-head');
    expect(host.querySelectorAll('[role="tab"]').length).toBe(4); // 步进器四环节可点
  });

  it('环节①回顾:错题卡 + 标记已回顾 + 进入新课', () => {
    const host = mount(<WarmupSegment items={wrongItems} reviewed={[1]} onReview={noop} onNext={noop} />);
    assertTouch44(host, 'warmup');
    expect(host.textContent).toContain('已回顾');
    expect(host.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2); // 题干 TexText
  });

  it('环节②课件:分页按钮 + 打点小测选项(末页)', () => {
    const host = mount(<LectureSegment pages={CLASS_COURSEWARE} onTouch={noop} onDone={noop} />);
    assertTouch44(host, 'lecture');
    expect(host.textContent).toContain('第 1 / 3 页');
  });

  it('环节③随堂练:题卡选项/答题卡/AI 助教 chips 与输入', () => {
    const host = mount(
      <PracticeSegment state={joined} onAnswer={asyncNoop} onGoto={noop} onFlag={noop}
        onAsk={noop} onTouch={noop} onDone={noop} />,
    );
    assertTouch44(host, 'practice');
    expect(host.textContent).toContain('随堂练 · 第');
    expect(host.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(1);
  });

  it('环节③b 大题:AI 预批结果卡(✓/✕ 行 + 进入小结)', () => {
    const host = mount(<PreGradeCard narration={NARRATION_PRE_GRADE} onDone={noop} />);
    assertTouch44(host, 'pre-grade');
    expect(host.textContent).toContain('AI 预批');
    expect(host.textContent).toContain('✕');
  });

  it('环节④小结:下课/任务按钮', () => {
    const ended = reduceClass(joined, { type: 'control', control: { action: 'end' } });
    const host = mount(
      <SummarySegment state={ended} onOpenTask={noop} onExit={noop}
        pendingTasks={[{ id: 2, paperId: 3, paperName: '第3讲课后作业 · 订正', lessonId: 3, kind: 'correction', target: { studentIds: [4] }, publishAt: '2026-06-10T12:30:00.000Z', dueAt: '2026-06-13T13:00:00.000Z', scoreCounted: false, questionCount: 3, totalScore: 20 }]} />,
    );
    assertTouch44(host, 'summary');
    expect(host.textContent).toContain('下课,回到首页');
  });

  it('AI 助教侧栏:chips/输入/发送', () => {
    assertTouch44(mount(<TutorPanel chat={[]} guideOnly onAsk={noop} />), 'tutor');
  });

  it('底部 AI 旁白条渲染(narration 走 TexText)', () => {
    const host = mount(<ClassFoot narration="想想 $b$ 会变大还是变小?" />);
    expect(host.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(1);
  });

  it('源码扫描兜底:classroom 目录所有 <Button/<button 均显式写 min-h-touch', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) { if (!p.includes('__tests__')) walk(p); }
        else if (p.endsWith('.tsx')) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<(Button|button)\b/g)) {
        const windowSrc = src.slice(m.index, (m.index ?? 0) + 300);
        expect(windowSrc, `${path.basename(f)} 第 ${src.slice(0, m.index).split('\n').length} 行的 <${m[1]}> 缺 min-h-touch`).toMatch(/min-h-touch/);
      }
    }
  });
});
