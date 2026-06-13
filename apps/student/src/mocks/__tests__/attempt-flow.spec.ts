/**
 * mock 全链路(msw/node + contracts createClient,与浏览器同一份 handlers):
 * 作业开始 → 中途「刷新」 → 续答 → 交卷 → 看解析(任务卡 B5 验收主流程)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { createClient } from '@qiming/contracts';
import { handlers } from '../handlers';
import { resetStore } from '../student-store';
import type { AttemptWithQuestions } from '../../pages/homework/types';

const server = setupServer(...handlers);
let token: string | null = null;
// fetchImpl 延迟取 globalThis.fetch:server.listen() 在 beforeAll 才打补丁
const api = createClient({
  baseUrl: 'http://localhost/api/v1',
  getToken: () => token,
  fetchImpl: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetStore());

describe('作业全流程(断点续答有状态)', () => {
  it('开始→答 2 题→刷新恢复→续答→交卷→看解析;错题本/今日进度联动', async () => {
    // 学生学号密码登录
    const login = await api.post('/auth/student/login', {
      body: { studentNo: 'S-0001', password: 'Student@123' },
    });
    token = login.data.accessToken;

    // 今日:订正任务待开始
    const today0 = await api.get('/student/today');
    const task0 = today0.data.tasks.find((t) => t.assignmentId === 2)!;
    expect(task0.progress).toMatchObject({ answered: 0, total: 3, status: 'not_started' });

    // 开始作答:题面随 attempt 下发(契约 AttemptDto.questions)
    const started = (await api.post('/student/attempts', { body: { assignmentId: 2 } })).data as AttemptWithQuestions;
    expect(started.status).toBe('in_progress');
    expect(started.questions.map((q) => q.type)).toEqual(['single', 'blank', 'solution']);
    expect(started.questions[0].correctAnswer).toBeNull(); // 作答中不泄漏答案
    expect(started.questions.every((q) => q.correctAnswer == null && q.analysisLatex == null)).toBe(true);

    // 答第 1 题(单选,故意答错 → 即时判分 + 解析)
    const r1 = await api.put('/student/attempts/{id}/answers/{qid}', {
      params: { id: started.id, qid: started.questions[0].questionId },
      body: { response: { choice: 'A' } as never, flagged: true },
    });
    expect(r1.data).toMatchObject({ judged: true, isCorrect: false, correctAnswer: 'B' });
    expect(r1.data.analysisLatex).toBeTruthy();

    // 答第 2 题(填空,带全角与空格 → 归一化判对)
    const blankQid = started.questions[1].questionId;
    const r2 = await api.put('/student/attempts/{id}/answers/{qid}', {
      params: { id: started.id, qid: blankQid },
      body: { response: { texts: [' ｙ＝２ｘ－３ '] } as never },
    });
    expect(r2.data).toMatchObject({ judged: true, isCorrect: true, correctAnswer: null });

    // —— 模拟刷新:GET /student/attempts/{id} 恢复快照 ——
    const resumed = (await api.get('/student/attempts/{id}', { params: { id: started.id } })).data as AttemptWithQuestions;
    expect(resumed.id).toBe(started.id);
    expect(resumed.answers.filter((a) => a.response != null)).toHaveLength(2);
    expect(resumed.answers[0]).toMatchObject({ isCorrect: false, flagged: true });

    // 再次 POST 也返回同一 in_progress(契约口径)
    const again = (await api.post('/student/attempts', { body: { assignmentId: 2 } })).data as AttemptWithQuestions;
    expect(again.id).toBe(started.id);

    // 续答第 3 题(解答题拍照占位)→ 交卷
    await api.put('/student/attempts/{id}/answers/{qid}', {
      params: { id: started.id, qid: started.questions[2].questionId },
      body: { response: { photoOssKey: 'mock/uploads/answer.jpg' } as never },
    });
    const submitted = (await api.post('/student/attempts/{id}/submit', { params: { id: started.id } })).data as AttemptWithQuestions;
    expect(submitted.status).toBe('submitted'); // 含解答题 → 待老师复核出分
    expect(submitted.objectiveScore).toBe(5);   // 填空 5 分

    // 看解析:交卷后快照下发 correctAnswer(契约 QuestionAnswer 对象)/analysisLatex
    const review = (await api.get('/student/attempts/{id}', { params: { id: started.id } })).data as AttemptWithQuestions;
    expect(review.questions[0].correctAnswer).toEqual({ choice: 'B' });
    expect(review.questions[0].analysisLatex).toBeTruthy();

    // 今日进度联动 + 错题本:q13 订正答错 → wrongCount 1→2 且重置订正计数
    const today1 = await api.get('/student/today');
    expect(today1.data.tasks.find((t) => t.assignmentId === 2)!.progress.status).toBe('submitted');
    const wrong = await api.get('/student/wrong-book', { query: { page: 1, size: 50 } });
    expect(wrong.data.total).toBe(6);
    const w13 = wrong.data.items.find((w) => w.questionId === 13)!;
    expect(w13).toMatchObject({ wrongCount: 2, status: 'open', correctRedoCount: 0 });
  });

  it('错题重做闭环:redo → 全对 graded → 对 2 次 cleared;redo-all 生成重练卷', async () => {
    const login = await api.post('/auth/student/login', {
      body: { studentNo: 'S-0001', password: 'Student@123' },
    });
    token = login.data.accessToken;

    for (let round = 1; round <= 2; round++) {
      const asg = (await api.post('/student/wrong-book/{id}/redo', { params: { id: 1 } })).data;
      expect(asg).toMatchObject({ kind: 'wrong_redo', scoreCounted: false, questionCount: 1 });
      const at = (await api.post('/student/attempts', { body: { assignmentId: asg.id } })).data as AttemptWithQuestions;
      await api.put('/student/attempts/{id}/answers/{qid}', {
        params: { id: at.id, qid: at.questions[0].questionId },
        body: { response: { choice: 'B' } as never },
      });
      const done = (await api.post('/student/attempts/{id}/submit', { params: { id: at.id } })).data as AttemptWithQuestions;
      expect(done.status).toBe('graded'); // 纯客观题自动出分
    }
    const wrong = await api.get('/student/wrong-book', { query: { page: 1, size: 50 } });
    expect(wrong.data.items.find((w) => w.id === 1)!.status).toBe('cleared');

    // 已 cleared 再 redo → 409/4503
    await expect(api.post('/student/wrong-book/{id}/redo', { params: { id: 1 } })).rejects.toMatchObject({ code: 4503 });

    const all = (await api.post('/student/wrong-book/redo-all')).data;
    expect(all.questionCount).toBe(5); // 剩余 5 道 open
  });
});
