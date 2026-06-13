/** 入班候选过滤(IMPL #2):候选 = 全部学生 − 当前课程 active 名单 */
import { describe, expect, it } from 'vitest';
import { candidateStudents } from '../roster';

const all = [
  { id: 1, name: 'A' },
  { id: 2, name: 'B' },
  { id: 3, name: 'C' },
  { id: 4, name: 'D' },
];

describe('candidateStudents', () => {
  it('排除已在课程的 active 学生', () => {
    const roster = [
      { studentId: 1, status: 'active' },
      { studentId: 2, status: 'active' },
    ];
    expect(candidateStudents(all, roster).map((s) => s.id)).toEqual([3, 4]);
  });

  it('新课(0 人)→ 全部学生可选', () => {
    expect(candidateStudents(all, []).map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });

  it('已退课(非 active)学生可重新入班(不计入已在课程)', () => {
    const roster = [
      { studentId: 1, status: 'active' },
      { studentId: 2, status: 'quit' },
    ];
    // 仅 1 号被排除;2 号虽在名单但已退课,仍是候选
    expect(candidateStudents(all, roster).map((s) => s.id)).toEqual([2, 3, 4]);
  });

  it('全员在课 → 候选为空', () => {
    const roster = all.map((s) => ({ studentId: s.id, status: 'active' }));
    expect(candidateStudents(all, roster)).toEqual([]);
  });
});
