/**
 * 大纲编辑操作(向导第 2 步):插入/删除/调序的边界 + 输入校验 + 耗时估算
 */
import { describe, expect, it } from 'vitest';
import {
  LIMITS, PAGE_COUNT_DEFAULT, PAGE_COUNT_MAX, PAGE_COUNT_MIN, canInsertPage, clampPageCount, emptyPage,
  estimateSeconds, formatEstimate, insertPage, movePage, removePage, updatePage, validateInput, validateOutline,
} from '../outline';
import type { CoursewareOutlinePageDto } from '@qiming/contracts';

const page = (title: string): CoursewareOutlinePageDto => ({ title, body: `${title} 要点`, imagePrompt: `${title} 画面` });
const titles = (pages: CoursewareOutlinePageDto[]) => pages.map((p) => p.title);

describe('insertPage', () => {
  it('index=0 插到最前,index=length 追加到末尾', () => {
    const pages = [page('A'), page('B')];
    expect(titles(insertPage(pages, 0, page('X')))).toEqual(['X', 'A', 'B']);
    expect(titles(insertPage(pages, 2, page('X')))).toEqual(['A', 'B', 'X']);
    expect(titles(insertPage(pages, 1, page('X')))).toEqual(['A', 'X', 'B']);
  });

  it('越界索引夹取到 [0, length],不丢页', () => {
    const pages = [page('A'), page('B')];
    expect(titles(insertPage(pages, -5, page('X')))).toEqual(['X', 'A', 'B']);
    expect(titles(insertPage(pages, 99, page('X')))).toEqual(['A', 'B', 'X']);
  });

  it('空列表插入 → 1 页;缺省插入空白页', () => {
    const inserted = insertPage([], 0);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual(emptyPage());
  });

  it('不改原数组(纯函数)', () => {
    const pages = [page('A')];
    insertPage(pages, 0, page('X'));
    expect(titles(pages)).toEqual(['A']);
  });
});

describe('removePage', () => {
  it('删中间页;越界索引原样返回', () => {
    const pages = [page('A'), page('B'), page('C')];
    expect(titles(removePage(pages, 1))).toEqual(['A', 'C']);
    expect(removePage(pages, -1)).toBe(pages);
    expect(removePage(pages, 3)).toBe(pages);
  });

  it('删到空 → 空数组', () => {
    expect(removePage([page('A')], 0)).toEqual([]);
  });
});

describe('movePage', () => {
  it('上移/下移交换相邻两页', () => {
    const pages = [page('A'), page('B'), page('C')];
    expect(titles(movePage(pages, 1, -1))).toEqual(['B', 'A', 'C']);
    expect(titles(movePage(pages, 1, 1))).toEqual(['A', 'C', 'B']);
  });

  it('首页上移 / 末页下移 / 越界索引 → 原样返回', () => {
    const pages = [page('A'), page('B')];
    expect(movePage(pages, 0, -1)).toBe(pages);
    expect(movePage(pages, 1, 1)).toBe(pages);
    expect(movePage(pages, 9, -1)).toBe(pages);
  });
});

describe('updatePage', () => {
  it('只改目标页的目标字段', () => {
    const pages = [page('A'), page('B')];
    const next = updatePage(pages, 1, { title: 'B2' });
    expect(titles(next)).toEqual(['A', 'B2']);
    expect(next[1].body).toBe('B 要点');
    expect(updatePage(pages, 5, { title: 'x' })).toBe(pages);
  });
});

describe('校验与估算', () => {
  it('validateInput:名称/文字稿必填,页数需在范围内', () => {
    expect(validateInput({ name: '课件', sourceText: '勾股定理', pageCount: 8 })).toEqual([]);
    expect(validateInput({ name: '  ', sourceText: ' ', pageCount: 8 }))
      .toEqual(['请填写课件名称', '请填写文字稿或本节课内容范围']);
    expect(validateInput({ name: '课件', sourceText: '勾股定理', pageCount: 2 }))
      .toEqual([`期望页数需在 ${PAGE_COUNT_MIN}–${PAGE_COUNT_MAX} 之间`]);
    expect(validateInput({ name: '课件', sourceText: '勾股定理', pageCount: 21 })).toHaveLength(1);
  });

  it('validateOutline:空大纲拦截,缺标题的页按序号列出', () => {
    expect(validateOutline([])).toEqual(['大纲至少需要 1 页']);
    expect(validateOutline([page('A'), { title: ' ', body: '', imagePrompt: '' }, page('C')]))
      .toEqual(['第 2 页缺少标题']);
    expect(validateOutline([page('A')])).toEqual([]);
  });

  it('上限与后端 DTO 同数:超长文本在前端就拦下(不靠 400 兜底)', () => {
    expect(validateInput({ name: 'x'.repeat(LIMITS.name + 1), sourceText: '勾股定理', pageCount: 8 }))
      .toEqual([`课件名称最多 ${LIMITS.name} 字`]);
    expect(validateInput({ name: '课件', sourceText: 'x'.repeat(LIMITS.sourceText + 1), pageCount: 8 }))
      .toEqual([`文字稿最多 ${LIMITS.sourceText} 字`]);
    expect(validateOutline([{ title: 'A', body: 'x'.repeat(LIMITS.body + 1), imagePrompt: '' }]))
      .toEqual([`第 1 页要点超过 ${LIMITS.body} 字`]);
    expect(validateOutline([{ title: 'A', body: '', imagePrompt: 'x'.repeat(LIMITS.imagePrompt + 1) }]))
      .toEqual([`第 1 页画面描述超过 ${LIMITS.imagePrompt} 字`]);
  });

  it(`插页到 ${PAGE_COUNT_MAX} 页封顶:canInsertPage 转 false,insertPage 原样返回`, () => {
    const full = Array.from({ length: LIMITS.pages }, (_, i) => page(`P${i + 1}`));
    expect(canInsertPage(full.slice(0, -1))).toBe(true);
    expect(canInsertPage(full)).toBe(false);
    expect(insertPage(full, 0)).toBe(full);
    expect(validateOutline([...full, page('X')])[0]).toBe(`大纲最多 ${LIMITS.pages} 页,请先删掉多余的页`);
  });

  it('clampPageCount:越界夹取、非法值取默认', () => {
    expect(clampPageCount(8)).toBe(8);
    expect(clampPageCount(1)).toBe(PAGE_COUNT_MIN);
    expect(clampPageCount(99)).toBe(PAGE_COUNT_MAX);
    expect(clampPageCount(7.4)).toBe(7);
    expect(clampPageCount(Number.NaN)).toBe(PAGE_COUNT_DEFAULT);
  });

  it('estimateSeconds/formatEstimate:8 页 ≈ 3 分 20 秒', () => {
    expect(estimateSeconds(8)).toBe(200);
    expect(formatEstimate(200)).toBe('约 3 分 20 秒');
    expect(formatEstimate(estimateSeconds(1))).toBe('约 25 秒');
    expect(formatEstimate(120)).toBe('约 2 分钟');
  });
});
