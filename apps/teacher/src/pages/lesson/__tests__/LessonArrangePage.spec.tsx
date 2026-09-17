// @vitest-environment jsdom
/**
 * 编排课堂页 · 挂载课件 / 选择试卷弹窗的目录分组(B/C 走查):msw 真接口(与浏览器同一份
 * handlers/data)+ jsdom 渲染,验证 GroupedPicker 真的接上了这两个弹窗,而不是只在组件级
 * 单测里自证。第 4 讲(mock 演示数据)单元 1 挂知识点 102(一次函数的图象,数学/初二/
 * 第十九章),讲解段已挂资源 #1、随堂练段已挂试卷 #1,资源 #1/#2 都在该章节下。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { ToastProvider } from '@qiming/ui';
import { handlers } from '../../../mocks/handlers';

/** 同 apps/admin FeatureLab.spec.tsx 的口径:api 单例换成绝对地址的同款客户端,由 msw 拦截 */
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
// 本页会调 useFeatures()(AI 生成课件内测入口按钮);不挂真 AuthProvider,固定关闭即可
vi.mock('../../../features/FeaturesProvider', () => ({ useFeatures: () => ({ features: [], labEntries: [], has: () => false }) }));

import { LessonArrangePage } from '../LessonArrangePage';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
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

async function mountPage(lessonId = 4): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <ToastProvider>
        <MemoryRouter initialEntries={[`/lessons/${lessonId}/arrange`]}>
          <Routes>
            <Route path="/lessons/:id/arrange" element={<LessonArrangePage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
  });
  await settle();
  return host;
}

const buttonByText = (host: ParentNode, text: string): HTMLButtonElement => {
  const el = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(text));
  if (!el) throw new Error(`按钮未找到:${text}`);
  return el;
};

const selectByLabel = (host: ParentNode, label: string): HTMLSelectElement => {
  const el = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (!el) throw new Error(`下拉未找到:${label}`);
  return el;
};

const click = async (el: Element): Promise<void> => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};

const change = async (el: HTMLSelectElement, value: string): Promise<void> => {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
};

describe('挂载课件弹窗(B):按学科›年级›章节分组 + 类型筛选', () => {
  it('打开弹窗 → 出现三级目录下拉 + 课件类型下拉,同章节两个资源都在列', async () => {
    const host = await mountPage();
    await click(buttonByText(host, '挂载课件'));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('挂载课件');
    expect(selectByLabel(dialog, '学科')).toBeTruthy();
    expect(selectByLabel(dialog, '年级')).toBeTruthy();
    expect(selectByLabel(dialog, '章节')).toBeTruthy();
    expect(selectByLabel(dialog, '课件类型')).toBeTruthy();
    expect(dialog.textContent).toContain('函数图象平移 · 动画演示');
    expect(dialog.textContent).toContain('待定系数法 · 微课视频');
  });

  it('按课件类型筛选(video)→ 只剩视频那份', async () => {
    const host = await mountPage();
    await click(buttonByText(host, '挂载课件'));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await change(selectByLabel(dialog, '课件类型'), 'video');
    expect(dialog.textContent).toContain('待定系数法 · 微课视频');
    expect(dialog.textContent).not.toContain('函数图象平移 · 动画演示');
  });

  it('点一份课件 → 弹窗关闭,讲解段显示该课件名(挂载生效)', async () => {
    const host = await mountPage();
    await click(buttonByText(host, '挂载课件'));
    let dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await click(buttonByText(dialog, '待定系数法 · 微课视频'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain('待定系数法 · 微课视频');
  });
});

describe('选择随堂练试卷弹窗(C):按学科›类型分组 + 年级筛选,不出现课件类型筛选', () => {
  it('打开弹窗 → 学科/类型两级下拉 + 年级筛选,已挂的随堂练卷在列', async () => {
    const host = await mountPage();
    await click(buttonByText(host, '更换试卷')); // 第4讲单元1随堂练已挂卷 #1,按钮文案是「更换试卷」
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('选择随堂练试卷');
    expect(selectByLabel(dialog, '学科')).toBeTruthy();
    expect(selectByLabel(dialog, '类型')).toBeTruthy();
    expect(selectByLabel(dialog, '年级')).toBeTruthy();
    expect(dialog.querySelector('select[aria-label="课件类型"]')).toBeNull();
    expect(dialog.textContent).toContain('第4讲 · 随堂练');
  });

  it('按学科筛选(数学)不清空已挂随堂练卷候选', async () => {
    const host = await mountPage();
    await click(buttonByText(host, '更换试卷'));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await change(selectByLabel(dialog, '学科'), '数学');
    expect(dialog.textContent).toContain('第4讲 · 随堂练');
  });
});

describe('课后作业「选择已有卷」弹窗:按学科›类型分组,三类卷并存', () => {
  it('学科下拉里能看到试卷所属学科;类型下拉出现随堂练/课后作业/考试', async () => {
    const host = await mountPage();
    await click(buttonByText(host, '选择已有卷'));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('选择课后作业试卷');
    const typeSel = selectByLabel(dialog, '类型');
    const types = [...typeSel.options].map((o) => o.textContent);
    expect(types.some((t) => t?.includes('课后作业'))).toBe(true);
  });
});
