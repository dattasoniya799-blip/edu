import { describe, expect, it } from 'vitest';
import { pageWindow } from '../paging';

describe('pageWindow', () => {
  it('≤7 页全显', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('多页折叠为首尾 + 邻域(原型 1 2 3 … 58 形态)', () => {
    expect(pageWindow(1, 58)).toEqual([1, 2, '…', 57, 58]);
    expect(pageWindow(30, 58)).toEqual([1, 2, '…', 29, 30, 31, '…', 57, 58]);
    expect(pageWindow(58, 58)).toEqual([1, 2, '…', 57, 58]);
  });
});
