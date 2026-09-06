// @vitest-environment jsdom
/**
 * 实验室页(讲解件展台)· 静态目录,不打后端。
 *   1. 侧栏挂「实验室」路由 /lab;
 *   2. 页上列出三道讲解件,「打开」链到 public/lab/*.html 且新开页;
 *   3. 生产 base=/admin/ 时 href 带前缀;
 *   4. 三份单文件 HTML 已入库(部署随管理端静态资源走)。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '../Shell';
import { LAB_EXHIBITS, exhibitHref } from '../lab-exhibits';
import { Lab } from '../Lab';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicLab = path.resolve(here, '../../../public/lab');

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

async function mountPage(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<Lab />); });
  return host;
}

describe('侧栏实验室入口', () => {
  it('NAV_ITEMS 含「实验室」且落到 /lab', () => {
    const item = NAV_ITEMS.find((n) => n.label === '实验室');
    expect(item).toBeDefined();
    expect(item?.to).toBe('/lab');
    expect(item?.group).toBe('实 验');
  });
});

describe('exhibitHref', () => {
  it('开发 base=/ 时指向 /lab/<file>', () => {
    expect(exhibitHref('circle-angle.html', '/')).toBe('/lab/circle-angle.html');
  });
  it('生产 base=/admin/ 时带管理端前缀', () => {
    expect(exhibitHref('buoyancy.html', '/admin/')).toBe('/admin/lab/buoyancy.html');
  });
});

describe('实验室页渲染', () => {
  it('列出三道讲解件:标题、学科、打开链', async () => {
    const host = await mountPage();
    const text = host.textContent ?? '';
    expect(text).toContain('实验室');
    expect(LAB_EXHIBITS).toHaveLength(3);
    for (const ex of LAB_EXHIBITS) {
      expect(text).toContain(ex.title);
      expect(text).toContain(ex.subject);
    }
    const links = [...host.querySelectorAll<HTMLAnchorElement>('a[data-exhibit]')];
    expect(links).toHaveLength(3);
    for (const a of links) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toContain('noreferrer');
      const id = a.getAttribute('data-exhibit');
      const ex = LAB_EXHIBITS.find((e) => e.id === id);
      expect(ex).toBeDefined();
      expect(a.getAttribute('href')).toBe(exhibitHref(ex!.file));
      expect(a.textContent).toContain('打开');
    }
  });
});

describe('讲解件静态文件入库', () => {
  it('public/lab 下三份单文件 HTML 都在', () => {
    expect(LAB_EXHIBITS.length).toBe(3);
    for (const ex of LAB_EXHIBITS) {
      expect(existsSync(path.join(publicLab, ex.file)), ex.file).toBe(true);
    }
  });
});
