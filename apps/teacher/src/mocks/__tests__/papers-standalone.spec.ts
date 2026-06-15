/**
 * 独立组卷(PaperEditorPage)端到端逻辑:不依附讲次,直接建/改试卷。
 * 用 MSW + 真实 lib/paper 逻辑复刻页面的「选题 → 改分值算总分 → 提交调对端点 → 编辑回填」。
 * 关键断言:
 *   ① 新建 = 仅 POST /papers,不触发 POST /assignments(不挂讲次、不发作业);
 *   ② 选题/分值:toggleQuestion + 改分 → totalScore = 服务端重算 totalScore;
 *   ③ 编辑 = GET /papers/{id} 回填 → PUT /papers/{id} → 再 GET 生效;
 *   ④ 被作业引用的卷 PUT → 4302(库内「编辑」置灰的后端依据)。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { createClient } from '@qiming/contracts';
import type { PaperDto, QuestionDto } from '@qiming/contracts';
import { handlers } from '../handlers';
import {
  toPaperInput, toggleQuestion, totalScore, validatePaper, type PaperItem,
} from '../../pages/paper/lib/paper';

const server = setupServer(...handlers);
let token: string | null = null;
const api = createClient({
  baseUrl: 'http://localhost/api/v1',
  getToken: () => token,
  fetchImpl: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(async () => {
  const login = await api.post('/auth/login', { body: { phone: '13800000002', password: 'Teacher@123' } });
  token = login.data.accessToken;
});

/** 取题库前 N 道已入库题(页面 QuestionPicker 的数据源) */
async function bankQuestions(n = 3): Promise<QuestionDto[]> {
  const r = await api.get('/questions', { query: { page: 1, size: 50, status: 'published' } });
  return (r.data.items as QuestionDto[]).slice(0, n);
}

describe('选题 + 改分值 → 实时总分', () => {
  it('toggleQuestion 缺省分值,改分后 totalScore = Σ', async () => {
    const [q1, q2] = await bankQuestions(2);
    let items: PaperItem[] = [];
    items = toggleQuestion(items, q1.id, q1.type);
    items = toggleQuestion(items, q2.id, q2.type);
    expect(items.length).toBe(2);
    // 改第一题分值为 8
    items = items.map((it) => (it.questionId === q1.id ? { ...it, score: 8 } : it));
    const expected = 8 + items.find((it) => it.questionId === q2.id)!.score;
    expect(totalScore(items)).toBe(expected);
    // 再点一次第二题 → 移除
    items = toggleQuestion(items, q2.id, q2.type);
    expect(items.map((it) => it.questionId)).toEqual([q1.id]);
  });

  it('validatePaper 用「试卷」口径,空名 → 请填写试卷名称', () => {
    expect(validatePaper('  ', [{ questionId: 1, score: 5 }], '试卷')).toContain('请填写试卷名称');
    expect(validatePaper('独立卷', [{ questionId: 1, score: 5 }], '试卷')).toEqual([]);
  });
});

describe('新建独立卷:仅 POST /papers,不挂讲次/不发作业', () => {
  it('POST /papers 建独立 exam 卷,assignments 数量不变,卷入库可查', async () => {
    const before = (await api.get('/assignments')).data as unknown[];
    const qs = await bankQuestions(2);
    const items = qs.map((q) => ({ questionId: q.id, score: 7 }));

    const input = toPaperInput('独立组卷·一次函数测验', 'exam', items);
    const created = (await api.post('/papers', { body: input })).data as PaperDto;

    expect(created.id).toBeGreaterThan(0);
    expect(created.type).toBe('exam');
    // 服务端重算总分 = 页面实时总分
    expect(created.totalScore).toBe(totalScore(items));
    expect(created.questions.map((pq) => pq.questionId)).toEqual(qs.map((q) => q.id));

    // 关键:没有顺带创建任何作业
    const after = (await api.get('/assignments')).data as unknown[];
    expect(after.length).toBe(before.length);

    // 列表能查到这张新卷
    const list = (await api.get('/papers', { query: { page: 1, size: 200 } })).data as { items: PaperDto[] };
    expect(list.items.some((p) => p.id === created.id)).toBe(true);
  });
});

describe('编辑独立卷:GET 回填 → PUT 生效', () => {
  it('回填名称/类型/题目,改名+调分后 PUT,再 GET 已更新', async () => {
    // 先建一张可改的独立卷
    const qs = await bankQuestions(2);
    const created = (await api.post('/papers', {
      body: toPaperInput('待编辑卷', 'practice', qs.map((q) => ({ questionId: q.id, score: 5 }))),
    })).data as PaperDto;

    // 进入编辑页:GET /papers/{id} 回填
    const loaded = (await api.get('/papers/{id}', { params: { id: created.id } })).data as PaperDto;
    expect(loaded.name).toBe('待编辑卷');
    expect(loaded.type).toBe('practice');
    let items: PaperItem[] = loaded.questions.map((pq) => ({ questionId: pq.questionId, score: pq.score }));

    // 改名、第一题调 12 分、类型改 homework
    items = items.map((it, i) => (i === 0 ? { ...it, score: 12 } : it));
    await api.put('/papers/{id}', {
      params: { id: created.id },
      body: toPaperInput('编辑后的卷', 'homework', items),
    });

    const after = (await api.get('/papers/{id}', { params: { id: created.id } })).data as PaperDto;
    expect(after.name).toBe('编辑后的卷');
    expect(after.type).toBe('homework');
    expect(after.totalScore).toBe(totalScore(items));
  });

  it('被作业引用的卷 PUT → 4302(库内编辑置灰的后端依据)', async () => {
    // 找一张已被作业引用的卷:seed 中作业引用的 paperId
    const assignments = (await api.get('/assignments')).data as { paperName: string }[];
    expect(assignments.length).toBeGreaterThan(0);
    const papers = (await api.get('/papers', { query: { page: 1, size: 200 } })).data as { items: PaperDto[] };
    const referenced = papers.items.find((p) => assignments.some((a) => a.paperName === p.name));
    expect(referenced).toBeTruthy();

    await expect(
      api.put('/papers/{id}', {
        params: { id: referenced!.id },
        body: toPaperInput(referenced!.name, referenced!.type, referenced!.questions.map((q) => ({ questionId: q.questionId, score: q.score }))),
      }),
    ).rejects.toMatchObject({ code: 4302 });
  });
});
