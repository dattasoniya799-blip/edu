// @vitest-environment jsdom
/**
 * 首开作业 409 两态兜底(B1 / m2):
 * 1. POST /student/attempts 撞唯一约束(dev StrictMode 双发,409「资源已存在或唯一约束冲突」)
 *    → 降级重试一次创建即恢复;两次都失败才进错误态,错误态可「重试」(有上限,不循环);
 * 2. 409「该作业已完成,不可重复作答」→ 从 GET /student/assignments?status=all 的
 *    myAttempt.attemptId 自动加载成绩单(补 ?attempt=);拿不到 attemptId → errorKind='completed',
 *    页面错误态给「回作业列表」。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentDto } from '@qiming/contracts';
import { ToastProvider } from '@qiming/ui';
import type { AttemptWithQuestions } from '../types';

const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
const apiPut = vi.hoisted(() => vi.fn());
// 只替换 api 客户端本体;errorMessage / isConflict* 分类器用真实现(被测逻辑的一部分)
vi.mock('../../../api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../api')>();
  return { ...orig, api: { get: apiGet, post: apiPost, put: apiPut } };
});

import { useAttempt, type UseAttempt } from '../useAttempt';
import { HomeworkPage } from '../HomeworkPage';

// ---------- fixtures ----------
const err409Exists = () =>
  Object.assign(new Error('资源已存在或唯一约束冲突'), { code: 409, httpStatus: 409 });
const err409Completed = () =>
  Object.assign(new Error('该作业已完成,不可重复作答'), { code: 4502, httpStatus: 409 });

const attemptOf = (over: Partial<AttemptWithQuestions> = {}): AttemptWithQuestions => ({
  id: 77, assignmentId: 1, status: 'in_progress', attemptNo: 1,
  startedAt: '2026-07-01T00:00:00.000Z', submittedAt: null,
  score: null, objectiveScore: null, subjectiveScore: null,
  answers: [{ questionId: 11, response: null, isCorrect: null, score: null, flagged: false }],
  questions: [{
    seq: 1, questionId: 11, score: 5, type: 'single', stemLatex: '1+1=?',
    figures: [], options: [{ label: 'A', contentLatex: '2' }], correctAnswer: null, analysisLatex: null,
  }],
  ...over,
});

const asg = (myAttempt: AssignmentDto['myAttempt']): AssignmentDto => ({
  id: 1, paperId: 2, paperName: '第3讲课后作业', lessonId: null, kind: 'homework',
  target: { courseId: 1 }, publishAt: '2026-06-06T00:00:00.000Z', dueAt: null,
  scoreCounted: true, questionCount: 1, totalScore: 5, myAttempt,
});

// ---------- hook 测试挂具 ----------
let hook: UseAttempt;
function Harness({ attemptInUrl, onAttemptId }: { attemptInUrl: number | null; onAttemptId: (id: number) => void }) {
  hook = useAttempt(1, attemptInUrl, onAttemptId);
  return null;
}

async function mountHook(onAttemptId: (id: number) => void = () => undefined) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<Harness attemptInUrl={null} onAttemptId={onAttemptId} />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return root;
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
});

describe('F1 · 创建撞唯一约束(StrictMode 双发)降级重试', () => {
  it('首发 409「已存在」→ 自动重试一次创建成功,正常进入作答', async () => {
    apiPost.mockRejectedValueOnce(err409Exists()).mockResolvedValueOnce({ data: attemptOf() });
    const onId = vi.fn();
    await mountHook(onId);
    expect(hook.phase).toBe('answering');
    expect(onId).toHaveBeenCalledWith(77);
    expect(apiPost).toHaveBeenCalledTimes(2); // 原发 + 降级重试一次
    expect(apiPost).toHaveBeenLastCalledWith('/student/attempts', { body: { assignmentId: 1 } });
  });

  it('重试仍 409 → 错误态(不循环);retry() 可再走一次加载恢复', async () => {
    apiPost.mockRejectedValueOnce(err409Exists()).mockRejectedValueOnce(err409Exists());
    await mountHook();
    expect(hook.phase).toBe('error');
    expect(hook.errorKind).toBe('load');
    expect(hook.error).toContain('已存在');
    expect(apiPost).toHaveBeenCalledTimes(2); // 防重入:单次加载最多 2 次创建,不再多发

    apiPost.mockResolvedValueOnce({ data: attemptOf() });
    await act(async () => { hook.retry(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(hook.phase).toBe('answering');
    expect(apiPost).toHaveBeenCalledTimes(3);
  });
});

describe('F2 · 无 ?attempt= 直开已完成作业(409 不可重复作答)', () => {
  it('从 assignments myAttempt.attemptId 自动加载成绩单(补 ?attempt=)', async () => {
    apiPost.mockRejectedValue(err409Completed());
    apiGet.mockImplementation((path: string) =>
      path === '/student/assignments'
        ? Promise.resolve({ data: [asg({ attemptId: 55, status: 'submitted', score: null })] })
        : Promise.resolve({ data: attemptOf({ id: 55, status: 'submitted' }) }));
    const onId = vi.fn();
    await mountHook(onId);
    expect(hook.phase).toBe('result');
    expect(onId).toHaveBeenCalledWith(55); // HomeworkPage 据此把 ?attempt=55 补进 URL
    expect(apiGet).toHaveBeenCalledWith('/student/attempts/{id}', { params: { id: 55 } });
    expect(apiPost).toHaveBeenCalledTimes(1); // 「已完成」不做创建重试,不会循环 POST
  });

  it('assignments 里拿不到 attemptId → errorKind=completed 错误态', async () => {
    apiPost.mockRejectedValue(err409Completed());
    apiGet.mockResolvedValue({ data: [asg(null)] });
    await mountHook();
    expect(hook.phase).toBe('error');
    expect(hook.errorKind).toBe('completed');
    expect(hook.error).toContain('已完成');
  });
});

// ---------- 页面级:错误态按钮 ----------
async function mountPage(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/homework/1']}>
          <Routes><Route path="/homework/:assignmentId" element={<HomeworkPage />} /></Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  return host;
}

describe('HomeworkPage 错误态按钮', () => {
  it('一般加载失败:给「重试」与「回到今日」,点重试重新加载成功', async () => {
    apiPost.mockRejectedValueOnce(err409Exists()).mockRejectedValueOnce(err409Exists());
    apiGet.mockImplementation((path: string) =>
      path === '/student/assignments'
        ? Promise.resolve({ data: [asg(null)] })
        : Promise.resolve({ data: attemptOf() }));
    const host = await mountPage();
    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(labels.some((t) => t.includes('重试'))).toBe(true);
    expect(labels.some((t) => t.includes('回到今日'))).toBe(true);
    expect(labels.some((t) => t.includes('回作业列表'))).toBe(false);

    apiPost.mockResolvedValueOnce({ data: attemptOf() });
    const retryBtn = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('重试'))!;
    await act(async () => { retryBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain('第 1 / 1 题'); // 已进入作答界面
  });

  it('已完成且定位不到成绩单:给「回作业列表」', async () => {
    apiPost.mockRejectedValue(err409Completed());
    apiGet.mockResolvedValue({ data: [asg(null)] });
    const host = await mountPage();
    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(labels.some((t) => t.includes('回作业列表'))).toBe(true);
    expect(host.textContent).toContain('该作业已完成');
  });
});
