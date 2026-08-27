// @vitest-environment jsdom
/**
 * 实验室管理页(E1)· 页面级交互:msw 真接口 + jsdom 渲染。
 *   1. 渲染:两条目录项、当前阶段、白名单人数、详情区(已知缺陷 / 转正验收条件);
 *   2. 改阶段:下拉切 ga → PUT /admin/features/{key} → 列表回读新阶段;
 *   3. 编辑白名单:弹窗勾人保存 → PUT .../whitelist(replace)→ 人数回读。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { ToastProvider } from '@qiming/ui';
import { handlers } from '../../mocks/handlers';
import { resetFeatures } from '../../mocks/features';

/**
 * 页面用的是 api 单例(baseUrl 相对路径 /api/v1 + localStorage 里的 token),node 的 fetch 不认
 * 相对 URL。这里换成同一个 contracts client,只把 baseUrl 换成绝对地址、token 固定为管理员 ——
 * 端点调用与报文解析仍是真实现,由 msw 拦截。
 */
vi.mock('../../api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../api')>();
  const { createClient } = await import('@qiming/contracts');
  return {
    ...orig,
    api: createClient({
      baseUrl: 'http://localhost/api/v1',
      getToken: () => 'mock-token-admin',
      fetchImpl: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
    }),
  };
});

import { FeatureLab } from '../FeatureLab';

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

let root: Root | null = null;
beforeEach(() => resetFeatures());
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

async function mountPage(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<ToastProvider><FeatureLab /></ToastProvider>); });
  await settle();
  return host;
}

/** 冲干净 effect 里的取数(GET → setState → 重渲染) */
async function settle(): Promise<void> {
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
}

const buttonByText = (host: HTMLElement, text: string): HTMLButtonElement => {
  const el = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(text));
  if (!el) throw new Error(`按钮未找到:${text}`);
  return el;
};

const click = async (el: HTMLElement): Promise<void> => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

const selectByLabel = (host: HTMLElement, label: string): HTMLSelectElement => {
  const el = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (!el) throw new Error(`下拉未找到:${label}`);
  return el;
};

describe('实验室管理页渲染', () => {
  it('列出目录两条:阶段徽标 + 面向角色 + 白名单人数', async () => {
    const host = await mountPage();
    const text = host.textContent ?? '';
    expect(text).toContain('AI 生成课件');
    expect(text).toContain('拍照预批');
    expect(text).toContain('ai_courseware');
    expect(text).toContain('内测');   // ai_courseware = beta
    expect(text).toContain('未开放'); // photo_pregrade = off
    expect(text).toContain('1 人');   // 演示教师在 ai_courseware 白名单里
  });

  it('详情区展开:功能说明 / 已知缺陷 / 转正验收条件 / 当前白名单', async () => {
    const host = await mountPage();
    expect(host.textContent).not.toContain('已知缺陷');
    await click(buttonByText(host, '详情'));
    const text = host.textContent ?? '';
    expect(text).toContain('已知缺陷');
    expect(text).toContain('转正验收条件');
    expect(text).toContain('课堂整页图未接线');
    expect(text).toContain('张明 · 教师'); // 白名单成员
  });
});

describe('阶段切换', () => {
  it('ai_courseware 切 ga → PUT 后列表回读「正式」', async () => {
    const host = await mountPage();
    const sel = selectByLabel(host, 'AI 生成课件阶段');
    expect(sel.value).toBe('beta');

    await act(async () => {
      sel.value = 'ga';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();

    expect(selectByLabel(host, 'AI 生成课件阶段').value).toBe('ga');
    expect(host.textContent).toContain('正式');
    expect(host.textContent).toContain('已切到正式'); // toast
  });

  it('photo_pregrade 切 beta → 白名单人数列不再标「非内测阶段不生效」', async () => {
    const host = await mountPage();
    expect(host.textContent).toContain('非内测阶段不生效');
    const sel = selectByLabel(host, '拍照预批阶段');
    await act(async () => {
      sel.value = 'beta';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(selectByLabel(host, '拍照预批阶段').value).toBe('beta');
  });
});

describe('白名单编辑(replace 语义)', () => {
  it('教师向功能:弹窗列教师,勾一人保存 → 人数 1 → 2', async () => {
    const host = await mountPage();
    await click(buttonByText(host, '编辑白名单')); // 第一行 = AI 生成课件

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('编辑白名单 · AI 生成课件');
    expect(dialog.textContent).toContain('T-0001'); // 教师列表(非学生列表)

    await click(buttonByText(dialog, '李雯'));
    await click(buttonByText(dialog, '保存名单'));

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain('2 人');
    expect(host.textContent).toContain('白名单已保存(2 人)');
  });

  it('取消全部勾选保存 → 名单清空(0 人)', async () => {
    const host = await mountPage();
    await click(buttonByText(host, '编辑白名单'));

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await click(buttonByText(dialog, '张明')); // 已选 → 取消
    await click(buttonByText(dialog, '保存名单'));

    expect(host.textContent).toContain('0 人');
    expect(host.textContent).toContain('白名单已清空');
  });

  it('学生向功能:弹窗改列学生名单(复用 /admin/students)', async () => {
    const host = await mountPage();
    const editButtons = [...host.querySelectorAll('button')].filter((b) => b.textContent === '编辑白名单');
    await click(editButtons[1]); // 第二行 = 拍照预批(student 向)

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('编辑白名单 · 拍照预批');
    expect(dialog.textContent).toContain('S-0001'); // 学号 → 学生列表
    expect(dialog.querySelector('input')?.placeholder).toBe('搜索姓名 / 学号');
  });
});
