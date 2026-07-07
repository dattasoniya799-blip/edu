/**
 * 题库目录(知识体系)纯逻辑单测:
 * 学科↔目录联动(graphsForSubject / resolveGraphForSubject)——反馈「知识点选择和科目章节不联动」
 */
import { describe, expect, it } from 'vitest';
import type { KpGraphDto } from '@qiming/contracts';
import { graphsForSubject, resolveGraphForSubject } from '../kpTree';

/** 库里现状:数学 3 张(教材/能力/策略)+ 物理、化学各 1 张教材 */
const g = (id: number, subject: string, graphType: KpGraphDto['graphType']): KpGraphDto =>
  ({ id, code: `g${id}`, graphType, subject, nodeCount: 0 });
const GRAPHS: KpGraphDto[] = [
  g(1, '数学', 'curriculum_knowledge'),
  g(2, '数学', 'problem_solving_ability'),
  g(3, '数学', 'problem_solving_strategy'),
  g(4, '物理', 'curriculum_knowledge'),
  g(5, '化学', 'curriculum_knowledge'),
];

describe('graphsForSubject(学科筛选下可见的知识体系)', () => {
  it('选了学科 → 只列该学科的体系', () => {
    expect(graphsForSubject(GRAPHS, '数学').map((x) => x.id)).toEqual([1, 2, 3]);
    expect(graphsForSubject(GRAPHS, '物理').map((x) => x.id)).toEqual([4]);
  });

  it('学科=全部("")→ 列全部体系', () => {
    expect(graphsForSubject(GRAPHS, '').map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('该学科没有任何体系(如语文)→ 回退全部,下拉不清空', () => {
    expect(graphsForSubject(GRAPHS, '语文').map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('resolveGraphForSubject(切学科后目录联动,以学科为主)', () => {
  it('当前是数学教材,切「物理」→ 自动切到物理教材知识点体系', () => {
    expect(resolveGraphForSubject(GRAPHS, '物理', 1)).toBe(4);
  });

  it('当前体系与所选学科矛盾 → 以学科为主(数学·解题能力 + 选化学 → 化学教材)', () => {
    expect(resolveGraphForSubject(GRAPHS, '化学', 2)).toBe(5);
  });

  it('优先该学科的教材知识点体系(即使不是该学科第一张)', () => {
    const shuffled = [g(2, '数学', 'problem_solving_ability'), g(1, '数学', 'curriculum_knowledge')];
    expect(resolveGraphForSubject(shuffled, '数学', 99)).toBe(1);
  });

  it('当前体系已属于该学科 → 保持不变,不打断教师', () => {
    expect(resolveGraphForSubject(GRAPHS, '数学', 3)).toBe(3);
  });

  it('清空学科(切回全部)→ 当前体系仍可见,保持不变', () => {
    expect(resolveGraphForSubject(GRAPHS, '', 4)).toBe(4);
  });

  it('当前未选体系(null)→ 给该学科教材体系;无图谱 → null', () => {
    expect(resolveGraphForSubject(GRAPHS, '物理', null)).toBe(4);
    expect(resolveGraphForSubject([], '物理', null)).toBeNull();
  });
});
