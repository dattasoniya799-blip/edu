// @vitest-environment jsdom
/**
 * GroupedPicker 组件级(B/C):目录级联渲染 + 逐级收窄 + 类型/关键词筛选 + 点选回调。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroupedPicker, type GroupedItem } from '../GroupedPicker';

const RESOURCE_ITEMS: GroupedItem[] = [
  { id: 1, name: '函数图象平移课件', meta: 'ppt · 本知识点', path: ['数学', '初二', '第十九章 一次函数'], kind: 'ppt' },
  { id: 2, name: '待定系数法视频', meta: 'video', path: ['数学', '初二', '第十九章 一次函数'], kind: 'video' },
  { id: 3, name: '二次函数动画', meta: 'interactive', path: ['数学', '初三', '第一章 二次函数'], kind: 'interactive' },
  { id: 4, name: '牛顿定律课件', meta: 'ppt', path: ['物理', '初二', '第五章 力与运动'], kind: 'ppt' },
  { id: 5, name: '未归档截图', meta: 'image', path: ['未归类'], kind: 'image' },
];

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function mount(node: React.ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(node); });
  return host;
}

const selectByLabel = (host: HTMLElement, label: string): HTMLSelectElement => {
  const el = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (!el) throw new Error(`下拉未找到:${label}`);
  return el;
};

/**
 * 直接 `el.value = x` 再派发事件对受控 select 有效,但受控 input 会被 React 的
 * ValueTracker 拦下(记的"上次值"跟设的新值一致,不认为有变化,onChange 不触发)——
 * 要绕过就得走原型上的 value setter(标准测试技巧,等价于 @testing-library fireEvent 内部做法)。
 */
const change = (el: HTMLSelectElement | HTMLInputElement, value: string) => {
  act(() => {
    if (el.tagName === 'SELECT') {
      el.value = value;
    } else {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, value);
    }
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};

const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('GroupedPicker · 挂载课件场景(学科›年级›章节 + 类型)', () => {
  it('初始渲染:三级目录下拉 + 类型下拉 + 全部条目', () => {
    const host = mount(
      <GroupedPicker
        items={RESOURCE_ITEMS} levelLabels={['学科', '年级', '章节']} kindLabel="课件类型"
        selectedId={null} onSelect={() => {}} emptyText="暂无课件"
      />,
    );
    expect(selectByLabel(host, '学科')).toBeTruthy();
    expect(selectByLabel(host, '课件类型')).toBeTruthy();
    expect(host.textContent).toContain('函数图象平移课件');
    expect(host.textContent).toContain('未归档截图');
  });

  it('选学科=数学 → 年级下拉只出现初二/初三,列表收窄到数学', () => {
    const host = mount(
      <GroupedPicker
        items={RESOURCE_ITEMS} levelLabels={['学科', '年级', '章节']} kindLabel="课件类型"
        selectedId={null} onSelect={() => {}} emptyText="暂无课件"
      />,
    );
    change(selectByLabel(host, '学科'), '数学');
    const gradeSel = selectByLabel(host, '年级');
    const grades = [...gradeSel.options].map((o) => o.value).filter(Boolean);
    expect(grades).toEqual(['初二', '初三']);
    expect(host.textContent).not.toContain('牛顿定律课件');
    expect(host.textContent).toContain('待定系数法视频');
  });

  it('再选年级=初二 → 章节下拉只出现第十九章,列表只剩该章两项', () => {
    const host = mount(
      <GroupedPicker
        items={RESOURCE_ITEMS} levelLabels={['学科', '年级', '章节']} kindLabel="课件类型"
        selectedId={null} onSelect={() => {}} emptyText="暂无课件"
      />,
    );
    change(selectByLabel(host, '学科'), '数学');
    change(selectByLabel(host, '年级'), '初二');
    expect(host.textContent).toContain('函数图象平移课件');
    expect(host.textContent).toContain('待定系数法视频');
    expect(host.textContent).not.toContain('二次函数动画');
  });

  it('换学科(重选)→ 已选的年级/章节被清空重置', () => {
    const host = mount(
      <GroupedPicker
        items={RESOURCE_ITEMS} levelLabels={['学科', '年级', '章节']} kindLabel="课件类型"
        selectedId={null} onSelect={() => {}} emptyText="暂无课件"
      />,
    );
    change(selectByLabel(host, '学科'), '数学');
    change(selectByLabel(host, '年级'), '初三');
    expect(selectByLabel(host, '年级').value).toBe('初三');
    change(selectByLabel(host, '学科'), '物理');
    expect(selectByLabel(host, '年级').value).toBe('');
    expect(host.textContent).toContain('牛顿定律课件');
    expect(host.textContent).not.toContain('二次函数动画');
  });

  it('类型筛选(kind):仅 ppt', () => {
    const host = mount(
      <GroupedPicker
        items={RESOURCE_ITEMS} levelLabels={['学科', '年级', '章节']} kindLabel="课件类型"
        kindOptionLabels={{ ppt: 'PPT', video: '视频', interactive: '互动', image: '图片' }}
        selectedId={null} onSelect={() => {}} emptyText="暂无课件"
      />,
    );
    const kindSel = selectByLabel(host, '课件类型');
    expect(kindSel.textContent).toContain('PPT');
    change(kindSel, 'ppt');
    expect(host.textContent).toContain('函数图象平移课件');
    expect(host.textContent).toContain('牛顿定律课件');
    expect(host.textContent).not.toContain('待定系数法视频');
  });

  it('关键词搜索(匹配名称,忽略大小写)', () => {
    const host = mount(
      <GroupedPicker
        items={RESOURCE_ITEMS} levelLabels={['学科', '年级', '章节']} kindLabel="课件类型"
        selectedId={null} onSelect={() => {}} emptyText="暂无课件"
      />,
    );
    change(host.querySelector('input[aria-label="关键词搜索"]')!, '截图');
    expect(host.textContent).toContain('未归档截图');
    expect(host.textContent).not.toContain('函数图象平移课件');
  });

  it('点条目 → onSelect 带 id;选中项高亮(粗体样式类)', () => {
    const onSelect = vi.fn();
    const host = mount(
      <GroupedPicker
        items={RESOURCE_ITEMS} levelLabels={['学科', '年级', '章节']} kindLabel="课件类型"
        selectedId={2} onSelect={onSelect} emptyText="暂无课件"
      />,
    );
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('函数图象平移课件'))!;
    click(btn);
    expect(onSelect).toHaveBeenCalledWith(1);
    const selectedBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('待定系数法视频'))!;
    expect(selectedBtn.className).toContain('border-primary');
  });

  it('筛完没有命中项 → 空态文案', () => {
    const host = mount(
      <GroupedPicker
        items={RESOURCE_ITEMS} levelLabels={['学科', '年级', '章节']} kindLabel="课件类型"
        selectedId={null} onSelect={() => {}} emptyText="暂无课件"
      />,
    );
    change(host.querySelector('input[aria-label="关键词搜索"]')!, '不存在的名字xxx');
    expect(host.textContent).toContain('暂无课件');
  });
});

describe('GroupedPicker · 选卷场景(学科›类型,无 kind 筛选)', () => {
  const PAPER_ITEMS: GroupedItem[] = [
    { id: 10, name: '第4讲随堂练', meta: '5 题 · 30 分', path: ['数学', '随堂练'] },
    { id: 11, name: '第3讲课后作业', meta: '5 题 · 35 分', path: ['数学', '课后作业'] },
    { id: 12, name: '期中考试卷', meta: '8 题 · 65 分', path: ['未归类', '考试'] },
  ];

  it('两级目录(学科/类型),不出现类型筛选下拉(没传 kindLabel)', () => {
    const host = mount(
      <GroupedPicker items={PAPER_ITEMS} levelLabels={['学科', '类型']} selectedId={null} onSelect={() => {}} emptyText="暂无试卷" />,
    );
    expect(selectByLabel(host, '学科')).toBeTruthy();
    expect(selectByLabel(host, '类型')).toBeTruthy();
    expect(host.querySelector('select[aria-label="课件类型"]')).toBeNull();
  });

  it('选学科=未归类 → 只留期中考试卷', () => {
    const host = mount(
      <GroupedPicker items={PAPER_ITEMS} levelLabels={['学科', '类型']} selectedId={null} onSelect={() => {}} emptyText="暂无试卷" />,
    );
    change(selectByLabel(host, '学科'), '未归类');
    expect(host.textContent).toContain('期中考试卷');
    expect(host.textContent).not.toContain('第4讲随堂练');
  });
});
