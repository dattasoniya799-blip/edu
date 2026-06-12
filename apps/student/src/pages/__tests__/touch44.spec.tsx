// @vitest-environment jsdom
/**
 * 触控目标 ≥44px 断言(任务卡 B5:全部可点目标 ≥44px 且写测试断言)
 * 方案:jsdom 渲染关键交互组件 → 所有可点元素(button/label[for]/[role=button])
 * 必须带 min-h-touch(tailwind 预设 minHeight.touch = 44px);
 * 另以源码扫描兜底:五页目录里每个 <Button/<button 用法都必须写 min-h-touch。
 * 附带断言:数学内容(题干/选项/解析)经 TexText 渲染(.katex)。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WrongBookItemDto } from '@qiming/contracts';
import { AnswerCard } from '../homework/AnswerCard';
import { initQuiz } from '../homework/machine';
import { QuestionPanel } from '../homework/QuestionPanel';
import type { AttemptQuestionView } from '../homework/types';
import { LessonTimeline } from '../course/LessonTimeline';
import { TaskRow } from '../today/TaskRow';
import { FilterChip, WrongBookPage } from '../wrong/WrongBookPage';
import { WrongItemCard } from '../wrong/WrongItemCard';

void WrongBookPage; // 页面本体经源码扫描覆盖

// ---------------- 夹具 ----------------
const qSingle: AttemptQuestionView = {
  seq: 1, questionId: 13, score: 5, type: 'single',
  stemLatex: '将直线 $y=2x+1$ 向下平移 $3$ 个单位长度后,所得直线的解析式为(  )',
  figures: [],
  options: ['$y=2x+4$', '$y=2x-2$', '$y=5x+1$', '$y=-x+1$'].map((c, i) => ({ label: 'ABCD'[i], contentLatex: c })),
  correctAnswer: null, analysisLatex: null,
};
const qBlank: AttemptQuestionView = { ...qSingle, questionId: 11, type: 'blank', options: [], stemLatex: '解析式为 ________。' };
const qSolution: AttemptQuestionView = { ...qSingle, questionId: 4, type: 'solution', options: [] };
const emptyItem = { questionId: 13, response: null, flagged: false, feedback: null };

const quiz = initQuiz({
  answers: [
    { questionId: 13, response: { choice: 'B' }, isCorrect: true, score: 5, flagged: false },
    { questionId: 11, response: null, isCorrect: null, score: null, flagged: true },
    { questionId: 4, response: null, isCorrect: null, score: null, flagged: false },
  ],
});

const wrongItem: WrongBookItemDto = {
  id: 1, questionId: 13, type: 'single',
  stemLatex: '将直线 $y=-x+2$ 向上平移 $4$ 个单位长度(  )',
  analysisLatex: '「上加下减」:$b$ 由 $2$ 变为 $6$。',
  wrongCount: 2, correctRedoCount: 1, errorTags: ['图象平移符号'], status: 'open',
  sourceName: '第3讲课后作业', createdAt: '2026-06-07T10:30:00.000Z',
};

const timelineItems = [
  {
    lesson: { id: 3, courseId: 1, seq: 3, title: '第3讲 · 待定系数法', scheduledStart: '2026-06-06T06:00:00.000Z', scheduledEnd: null, status: 'finished' as const, prepChecklist: {} },
    myHomework: { assignmentId: 1, score: 16, wrongCount: 3 },
    resources: [{ id: 2, name: '微课视频', type: 'video' }],
  },
  {
    lesson: { id: 4, courseId: 1, seq: 4, title: '第4讲 · 图象平移', scheduledStart: new Date().toISOString(), scheduledEnd: null, status: 'ready' as const, prepChecklist: {} },
    myHomework: null, resources: [],
  },
];

// ---------------- 工具 ----------------
function mount(node: Parameters<typeof renderToStaticMarkup>[0]): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(node);
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

const noop = () => undefined;

// ---------------- 44px 断言 ----------------
describe('可点目标 ≥44px(min-h-touch)', () => {
  it('题卡:单选选项', () => {
    assertTouch44(mount(<QuestionPanel q={qSingle} item={emptyItem} draft={{ choice: 'A' }} onDraft={noop} />), '单选题卡');
  });
  it('题卡:填空输入', () => {
    assertTouch44(mount(<QuestionPanel q={qBlank} item={{ ...emptyItem, questionId: 11 }} draft={null} onDraft={noop} />), '填空题卡');
  });
  it('题卡:解答题拍照占位(上传 label 与手写入口)', () => {
    assertTouch44(mount(<QuestionPanel q={qSolution} item={{ ...emptyItem, questionId: 4 }} draft={null} onDraft={noop} />), '解答题卡');
  });
  it('答题卡格子(数字按钮另需 ≥44px 宽)', () => {
    const host = mount(<AnswerCard quiz={quiz} onGoto={noop} />);
    assertTouch44(host, '答题卡');
    for (const b of host.querySelectorAll('button')) expect(b.className).toMatch(/min-w-\[44px\]/);
  });
  it('今日任务行动作按钮', () => {
    assertTouch44(
      mount(<TaskRow task={{ assignmentId: 2, kind: 'correction', title: '订正', questionCount: 3, dueAt: null, progress: { answered: 0, total: 3, status: 'not_started' } }} onOpen={noop} onReview={noop} />),
      '任务行',
    );
  });
  it('讲次时间线:回看/订正/进入课堂', () => {
    assertTouch44(
      mount(<LessonTimeline items={timelineItems} correctionByLesson={{ 3: 2 }} onReplay={noop} onCorrect={noop} onEnterClass={noop} />),
      '讲次时间线',
    );
  });
  it('错题卡:重做/看解析;错因筛选胶囊', () => {
    assertTouch44(mount(<WrongItemCard item={wrongItem} onRedo={noop} />), '错题卡');
    assertTouch44(mount(<FilterChip active label="全部 (6)" onClick={noop} />), '筛选胶囊');
  });

  it('源码扫描兜底:五页目录所有 <Button/<button 均显式写 min-h-touch', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const dirs = ['today', 'course', 'homework', 'wrong', 'report'].map((d) => path.join(root, d));
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.tsx') && !p.includes('__tests__')) files.push(p);
      }
    };
    dirs.forEach(walk);
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<(Button|button)\b/g)) {
        const windowSrc = src.slice(m.index, (m.index ?? 0) + 260);
        expect(windowSrc, `${path.basename(f)} 第 ${src.slice(0, m.index).split('\n').length} 行的 <${m[1]}> 缺 min-h-touch`).toMatch(/min-h-touch/);
      }
    }
  });
});

// ---------------- TexText 断言 ----------------
describe('数学内容一律 TexText 渲染', () => {
  it('题干与选项渲染出 KaTeX', () => {
    const host = mount(<QuestionPanel q={qSingle} item={emptyItem} draft={null} onDraft={noop} />);
    expect(host.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(5); // 题干 1 + 选项 4
  });
  it('错题题干与解析渲染出 KaTeX(解析默认折叠,展开态由交互控制)', () => {
    const host = mount(<WrongItemCard item={wrongItem} onRedo={noop} />);
    expect(host.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(1);
  });
});
