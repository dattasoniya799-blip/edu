// @vitest-environment jsdom
/**
 * [2026-07-06 批准] 作业历史页 + 时间线成绩单直达:
 * 1. HomeworkListPage:GET /student/assignments?status=all 分「待完成/已完成」两组;
 *    已完成点击 → /homework/{id}?attempt={attemptId};待完成点击 → /homework/{id};随堂练(in_class)不入待办。
 * 2. LessonTimeline:myHomework.attemptId 有值 → 「作业 X 分」渲染为可点 button;缺失 → 不可点(Tag/span)。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AssignmentDto, LessonDto } from '@qiming/contracts';
import { LessonTimeline, type TimelineItem } from '../course/LessonTimeline';

const nav = vi.hoisted(() => vi.fn());
const apiGet = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }));
vi.mock('../../api', () => ({ api: { get: apiGet }, errorMessage: (_: unknown, f: string) => f }));

// mock 之后再引入被测页(确保拿到 mock 版 useNavigate / api)
import { HomeworkListPage } from '../homework/HomeworkListPage';

const noop = () => undefined;

const asg = (over: Partial<AssignmentDto> & Pick<AssignmentDto, 'id'>): AssignmentDto => ({
  id: over.id, paperId: 2, paperName: `作业${over.id}`, lessonId: null, kind: 'homework',
  target: { courseId: 1 }, publishAt: '2026-06-06T00:00:00.000Z', dueAt: null,
  scoreCounted: true, questionCount: 5, totalScore: 20, myAttempt: null, ...over,
});

const fixtures: AssignmentDto[] = [
  asg({ id: 1, paperName: '第3讲课后作业', myAttempt: { attemptId: 55, status: 'graded', score: 16 } }),
  asg({ id: 2, paperName: '第4讲课后作业', myAttempt: null }),
  asg({ id: 3, paperName: '课堂随堂练', kind: 'in_class', myAttempt: null }),
];

async function renderPage(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<HomeworkListPage />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); }); // flush effect fetch
  return host;
}

function clickButtonByText(host: HTMLElement, text: string): void {
  const btn = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(text));
  if (!btn) throw new Error(`按钮未找到:${text}`);
  act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

describe('作业历史页 HomeworkListPage', () => {
  beforeEach(() => { nav.mockReset(); apiGet.mockReset(); apiGet.mockResolvedValue({ data: fixtures }); });

  it('渲染「待完成 / 已完成」两组;随堂练不进待办', async () => {
    const host = await renderPage();
    const text = host.textContent ?? '';
    expect(text).toContain('待完成');
    expect(text).toContain('已完成');
    expect(text).toContain('第3讲课后作业'); // 已完成
    expect(text).toContain('第4讲课后作业'); // 待完成
    expect(text).toContain('16');            // 已完成分数
    expect(text).not.toContain('课堂随堂练'); // in_class 既未完成也不入待办 → 不出现
  });

  it('已完成点击 → 携 ?attempt= 打开成绩单', async () => {
    const host = await renderPage();
    clickButtonByText(host, '第3讲课后作业');
    expect(nav).toHaveBeenCalledWith('/homework/1?attempt=55');
  });

  it('待完成点击 → 进答题器(无 attempt)', async () => {
    const host = await renderPage();
    clickButtonByText(host, '第4讲课后作业');
    expect(nav).toHaveBeenCalledWith('/homework/2');
  });
});

describe('时间线作业分数可点(LessonTimeline)', () => {
  const finished: LessonDto = {
    id: 3, courseId: 1, seq: 3, title: '第3讲 · 待定系数法',
    scheduledStart: '2026-06-06T06:00:00.000Z', scheduledEnd: null, status: 'finished',
    prepChecklist: {}, openingConfig: null, sessionId: null,
  };
  const render = (item: TimelineItem) =>
    renderToStaticMarkup(
      <LessonTimeline items={[item]} correctionByLesson={{}} onReplay={noop} onCorrect={noop} onEnterClass={noop} onOpenResult={noop} />,
    );

  it('attemptId 有值 → 分数渲染为可点 button', () => {
    const html = render({ lesson: finished, resources: [], myHomework: { assignmentId: 1, attemptId: 55, score: 16, wrongCount: 0 } });
    expect(html).toContain('<button');
    expect(html).toContain('作业 16 分');
    expect(html).toMatch(/min-h-touch/);
  });

  it('attemptId 缺失 → 分数不可点(无 button,退化为 Tag)', () => {
    const html = render({ lesson: finished, resources: [], myHomework: { assignmentId: 1, attemptId: null, score: 16, wrongCount: 0 } });
    expect(html).toContain('作业 16 分');
    expect(html).not.toContain('<button');
  });
});
