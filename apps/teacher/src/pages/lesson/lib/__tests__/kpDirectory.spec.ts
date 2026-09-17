/**
 * 知识点目录(B/C 分组选择器数据源)单测:
 * ① 拼目录:只认 curriculum_knowledge 图谱,能力/策略图谱不参与;
 * ② 资源分组路径:学科 › 年级 › 章节,未挂/查不到知识点归「未归类」;
 * ③ 试卷年级推断:kpNodes 命中目录的年级取众数,一个都没命中归「未标年级」;
 * ④ 试卷分组路径:学科(契约已聚合)› 类型。
 */
import { describe, expect, it } from 'vitest';
import type { KpGraphDto, KpNodeDto, PaperDto } from '@qiming/contracts';
import {
  UNCATEGORIZED, UNGRADED, buildKpDirectory, curriculumGraphs, paperGrade, paperGroupPath, resourceGroupPath,
} from '../kpDirectory';

const g = (id: number, subject: string, graphType: KpGraphDto['graphType']): KpGraphDto =>
  ({ id, code: `g${id}`, graphType, subject, nodeCount: 0 });
const n = (id: number, graphId: number, grade: string | null, chapter: string | null): KpNodeDto => ({
  id, graphId, code: `n${id}`, name: `节点${id}`, parentCode: null, level: null, category: null,
  grade, chapter, section: null, difficulty: null, examWeight: null, summary: null, content: null,
});

const GRAPHS: KpGraphDto[] = [
  g(1, '数学', 'curriculum_knowledge'),
  g(2, '数学', 'problem_solving_ability'),
  g(4, '物理', 'curriculum_knowledge'),
];
const NODES_BY_GRAPH: Record<number, KpNodeDto[]> = {
  1: [n(101, 1, '初二', '第十九章 一次函数'), n(102, 1, '初三', '第一章 二次函数')],
  2: [n(201, 2, null, null)], // 能力图谱:节点无 grade/chapter,不应进目录
  // 4(物理)未拉取节点 → 缺失,目录里没有该图谱的节点,查不到时兜底
};

describe('curriculumGraphs', () => {
  it('只保留教材知识点图谱', () => {
    expect(curriculumGraphs(GRAPHS).map((x) => x.id)).toEqual([1, 4]);
  });
});

describe('buildKpDirectory', () => {
  const dir = buildKpDirectory(GRAPHS, NODES_BY_GRAPH);

  it('教材节点进目录,带学科/年级/章节', () => {
    expect(dir.get(101)).toEqual({ subject: '数学', grade: '初二', chapter: '第十九章 一次函数' });
    expect(dir.get(102)).toEqual({ subject: '数学', grade: '初三', chapter: '第一章 二次函数' });
  });

  it('能力/策略图谱的节点不进目录(即便传了 nodesByGraph)', () => {
    expect(dir.has(201)).toBe(false);
  });

  it('未拉取节点的图谱:目录里没有对应节点,不报错', () => {
    expect(dir.has(999)).toBe(false);
  });
});

describe('resourceGroupPath', () => {
  const dir = buildKpDirectory(GRAPHS, NODES_BY_GRAPH);

  it('挂了知识点且在目录里 → 学科/年级/章节三级', () => {
    expect(resourceGroupPath({ kpNodeId: 101 }, dir)).toEqual(['数学', '初二', '第十九章 一次函数']);
  });

  it('未挂知识点(kpNodeId=null)→ 未归类', () => {
    expect(resourceGroupPath({ kpNodeId: null }, dir)).toEqual([UNCATEGORIZED]);
  });

  it('挂了知识点但目录里查不到(如物理图谱节点未拉取)→ 未归类', () => {
    expect(resourceGroupPath({ kpNodeId: 88888 }, dir)).toEqual([UNCATEGORIZED]);
  });
});

describe('paperGrade', () => {
  const dir = buildKpDirectory(GRAPHS, NODES_BY_GRAPH);

  it('卷内知识点年级全一致 → 该年级', () => {
    expect(paperGrade({ kpNodes: [{ id: 101, name: 'a' }] }, dir)).toBe('初二');
  });

  it('卷内知识点年级混合 → 众数(出现次数多的);并列取先出现', () => {
    expect(paperGrade({ kpNodes: [{ id: 101, name: 'a' }, { id: 101, name: 'a' }, { id: 102, name: 'b' }] }, dir)).toBe('初二');
  });

  it('未挂知识点(空卷)→ 未标年级', () => {
    expect(paperGrade({ kpNodes: [] }, dir)).toBe(UNGRADED);
  });

  it('挂的知识点不在目录里(查不到年级)→ 未标年级', () => {
    expect(paperGrade({ kpNodes: [{ id: 99999, name: 'x' }] }, dir)).toBe(UNGRADED);
  });
});

describe('paperGroupPath', () => {
  const LABEL: Record<PaperDto['type'], string> = { practice: '随堂练', homework: '课后作业', exam: '考试' };

  it('学科 › 类型', () => {
    expect(paperGroupPath({ subject: '数学', type: 'practice' }, LABEL)).toEqual(['数学', '随堂练']);
  });

  it('空卷(subject=null)→ 未归类 › 类型', () => {
    expect(paperGroupPath({ subject: null, type: 'exam' }, LABEL)).toEqual([UNCATEGORIZED, '考试']);
  });
});
