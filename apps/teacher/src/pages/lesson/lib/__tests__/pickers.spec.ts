/**
 * 编排页弹窗数据口径单测:
 * ① 选知识点按课程学科取图谱(走查缺陷:非数学课的「选择知识点」恒列数学知识点)
 */
import { describe, expect, it } from 'vitest';
import type { KpGraphDto } from '@qiming/contracts';
import { arrangeKpGraphId } from '../pickers';

const g = (id: number, subject: string, graphType: KpGraphDto['graphType']): KpGraphDto =>
  ({ id, code: `g${id}`, graphType, subject, nodeCount: 0 });
/** 库里现状:数学 3 张(教材/能力/策略)+ 物理、化学各 1 张教材 */
const GRAPHS: KpGraphDto[] = [
  g(1, '数学', 'curriculum_knowledge'),
  g(2, '数学', 'problem_solving_ability'),
  g(3, '数学', 'problem_solving_strategy'),
  g(4, '物理', 'curriculum_knowledge'),
  g(5, '化学', 'curriculum_knowledge'),
];
const COURSES = [
  { id: 1, subject: '数学' },
  { id: 2, subject: '物理' },
  { id: 3, subject: '化学' },
];

describe('arrangeKpGraphId(编排「选择知识点」弹窗按课程学科取图谱)', () => {
  it('物理课 → 物理教材知识点图谱(而非恒取第一张=数学)', () => {
    expect(arrangeKpGraphId(GRAPHS, COURSES, 2)).toBe(4);
  });

  it('数学课 → 数学教材知识点图谱;化学课 → 化学', () => {
    expect(arrangeKpGraphId(GRAPHS, COURSES, 1)).toBe(1);
    expect(arrangeKpGraphId(GRAPHS, COURSES, 3)).toBe(5);
  });

  it('课程缺失(异常)→ 回退全部图谱里的教材知识点(旧口径,不清空弹窗)', () => {
    expect(arrangeKpGraphId(GRAPHS, COURSES, 99)).toBe(1);
    expect(arrangeKpGraphId(GRAPHS, [], 2)).toBe(1);
  });

  it('一张图谱都没有 → null(弹窗走空态)', () => {
    expect(arrangeKpGraphId([], COURSES, 2)).toBeNull();
  });
});
