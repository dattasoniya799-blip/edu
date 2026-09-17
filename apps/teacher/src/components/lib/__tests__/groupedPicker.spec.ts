/**
 * GroupedPicker 纯逻辑单测:级联可选项 + 多级路径/类型/关键词联合过滤。
 */
import { describe, expect, it } from 'vitest';
import { filterGroupedItems, kindsOf, optionsAtLevel, type GroupedItem } from '../groupedPicker';

const ITEMS: GroupedItem[] = [
  { id: 1, name: '函数图象平移课件', path: ['数学', '初二', '第十九章'], kind: 'ppt' },
  { id: 2, name: '待定系数法视频', path: ['数学', '初二', '第十九章'], kind: 'video' },
  { id: 3, name: '二次函数动画', path: ['数学', '初三', '第一章'], kind: 'interactive' },
  { id: 4, name: '牛顿定律课件', path: ['物理', '初二', '第五章'], kind: 'ppt' },
  { id: 5, name: '未归档截图', path: ['未归类'], kind: 'image' },
];

describe('optionsAtLevel', () => {
  it('第 0 级(未选任何上级):列全部学科,保序去重', () => {
    expect(optionsAtLevel(ITEMS, [])).toEqual(['数学', '物理', '未归类']);
  });

  it('已选学科=数学 → 第 1 级只列数学下的年级', () => {
    expect(optionsAtLevel(ITEMS, ['数学'])).toEqual(['初二', '初三']);
  });

  it('已选数学 › 初二 → 第 2 级只列该年级下的章节', () => {
    expect(optionsAtLevel(ITEMS, ['数学', '初二'])).toEqual(['第十九章']);
  });

  it('某级选择传空串(不限)→ 视作该级不过滤,仍下钻子级选项', () => {
    // 学科不限、年级=初二 → 数学和物理若都有「初二」,两边的章节都应出现
    expect(optionsAtLevel(ITEMS, ['', '初二'])).toEqual(['第十九章', '第五章']);
  });

  it('路径短于目标层级(如未归类只有 1 级)→ 该项不贡献该级选项,不报错', () => {
    expect(optionsAtLevel(ITEMS, ['未归类'])).toEqual([]);
  });
});

describe('filterGroupedItems', () => {
  it('逐级路径全命中 → 只留该分组下的项', () => {
    const r = filterGroupedItems(ITEMS, ['数学', '初二', '第十九章'], '', '');
    expect(r.map((x) => x.id)).toEqual([1, 2]);
  });

  it('某级留空(不限)→ 该级不过滤', () => {
    const r = filterGroupedItems(ITEMS, ['数学', ''], '', '');
    expect(r.map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it('叠加类型筛选(kind)', () => {
    const r = filterGroupedItems(ITEMS, ['数学', ''], 'ppt', '');
    expect(r.map((x) => x.id)).toEqual([1]);
  });

  it('叠加关键词(忽略大小写,匹配 name)', () => {
    const r = filterGroupedItems(ITEMS, [], '', '视频');
    expect(r.map((x) => x.id)).toEqual([2]);
  });

  it('全不选 → 返回全部', () => {
    expect(filterGroupedItems(ITEMS, [], '', '').length).toBe(ITEMS.length);
  });
});

describe('kindsOf', () => {
  it('按首次出现顺序去重', () => {
    expect(kindsOf(ITEMS)).toEqual(['ppt', 'video', 'interactive', 'image']);
  });

  it('没有任何项带 kind → 空数组', () => {
    expect(kindsOf([{ id: 1, name: 'x', path: ['a'] }])).toEqual([]);
  });
});
