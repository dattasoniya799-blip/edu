// @vitest-environment jsdom
/**
 * 试卷库页 · 走查 A 回归:用户报「点开就崩,刷新无用」,错误边界显示
 * `Cannot read properties of undefined (reading 'length')`。
 *
 * 根因不在当前服务端(apps/server/src/paper/paper.service.ts#toDto 始终把 questions/kpNodes
 * 拼成数组,从不缺失),而在页面此前直读 `p.questions.length` / `p.kpNodes.length`
 * 没有任何防守——契约把这两个字段标了 required,但"契约要求"不等于"运行时一定满足"
 * (版本滚动升级时的旧记录、未来重构、手工拼的半成品对象都可能给出缺字段的条目),
 * 一旦某条记录真的缺了这两个字段,整页就被 ErrorBoundary 接住,刷新也没用(数据本身就是坏的)。
 * 这里用 msw 覆盖 GET /papers,故意让列表里混一条缺 `questions`/`kpNodes` 的记录,
 * 验证页面现在会跳过/兜底渲染,而不是把整页炸掉;详情弹窗同理故意返回缺字段的详情。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ToastProvider } from '@qiming/ui';
import { handlers } from '../../../mocks/handlers';

vi.mock('../../../api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../api')>();
  const { createClient } = await import('@qiming/contracts');
  return {
    ...orig,
    api: createClient({
      baseUrl: 'http://localhost/api/v1',
      getToken: () => 'mock-token-teacher',
      fetchImpl: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
    }),
  };
});

import { PaperLibraryPage } from '../PaperLibraryPage';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

async function settle(): Promise<void> {
  await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
}

async function mountPage(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<ToastProvider><MemoryRouter><PaperLibraryPage /></MemoryRouter></ToastProvider>);
  });
  await settle();
  return host;
}

const click = async (el: Element): Promise<void> => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

/** 一条"坏"记录:缺 questions / kpNodes(模拟版本滚动升级 / 半成品对象),其余字段齐全 */
const BROKEN_PAPER = {
  id: 9001, name: '损坏的试卷(缺字段)', type: 'practice', totalScore: 20, status: 'published', subject: '数学',
  // questions / kpNodes 故意不带
};

describe('试卷库列表:混入缺 questions/kpNodes 的记录', () => {
  it('不崩溃(无 ErrorBoundary 兜底文案),坏记录按 0 题渲染,好记录不受影响', async () => {
    server.use(
      http.get('*/api/v1/papers', () =>
        HttpResponse.json({
          code: 0, message: 'ok',
          data: {
            items: [
              BROKEN_PAPER,
              { id: 1, name: '第4讲 · 随堂练', type: 'practice', totalScore: 30, status: 'published', subject: '数学', kpNodes: [], questions: [{ seq: 1, questionId: 1, score: 30, type: 'single', stemLatex: 'ok' }] },
            ],
            total: 2,
          },
        })),
      http.get('*/api/v1/assignments', () => HttpResponse.json({ code: 0, message: 'ok', data: [] })),
    );

    const host = await mountPage();

    // 页面正常渲染出两条,没有被 ErrorBoundary 接住(不会出现"页面出错了" / Cannot read properties)
    expect(host.textContent).not.toContain('Cannot read properties');
    expect(host.textContent).not.toContain('页面出错了');
    expect(host.textContent).toContain('损坏的试卷(缺字段)');
    expect(host.textContent).toContain('第4讲 · 随堂练');
    // 坏记录兜底成 0 题,不因为缺字段被吞成空态或崩溃
    expect(host.textContent).toContain('0 题 · 共 20 分');
  });

  it('展开详情返回缺字段的记录 → 展示"暂无题目"而不是崩溃', async () => {
    server.use(
      http.get('*/api/v1/papers', () =>
        HttpResponse.json({ code: 0, message: 'ok', data: { items: [BROKEN_PAPER], total: 1 } })),
      http.get('*/api/v1/assignments', () => HttpResponse.json({ code: 0, message: 'ok', data: [] })),
      http.get('*/api/v1/papers/:id', () => HttpResponse.json({ code: 0, message: 'ok', data: BROKEN_PAPER })),
    );

    const host = await mountPage();
    await click([...host.querySelectorAll('button')].find((b) => b.textContent === '查看详情')!);

    expect(host.textContent).not.toContain('Cannot read properties');
    expect(host.textContent).toContain('该试卷暂无题目');
  });
});
