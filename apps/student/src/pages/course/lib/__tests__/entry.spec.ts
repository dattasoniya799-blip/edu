/**
 * 学生进课堂判定(C2 #9):发布即可进,未发布/已结课不可进
 */
import { describe, expect, it } from 'vitest';
import { canEnterClassroom, enterClassLabel } from '../entry';

describe('canEnterClassroom', () => {
  it('已发布(ready)→ 可进', () => {
    expect(canEnterClassroom({ status: 'ready' })).toBe(true);
  });
  it('上课中(in_progress)→ 可进', () => {
    expect(canEnterClassroom({ status: 'in_progress' })).toBe(true);
  });
  it('未发布(draft)→ 不可进', () => {
    expect(canEnterClassroom({ status: 'draft' })).toBe(false);
  });
  it('已结课(finished)→ 不可进(走回看)', () => {
    expect(canEnterClassroom({ status: 'finished' })).toBe(false);
  });
  it('文案:进行中区分提示', () => {
    expect(enterClassLabel({ status: 'ready' })).toBe('进入课堂');
    expect(enterClassLabel({ status: 'in_progress' })).toBe('课堂进行中 · 进入');
  });
});
