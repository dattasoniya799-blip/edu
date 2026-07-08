/**
 * 题库目录(知识体系)纯逻辑单测:
 * ① 学科↔目录联动(graphsForSubject / resolveGraphForSubject)——反馈「知识点选择和科目章节不联动」
 * ② 节点辅助查询(nodeMatchesKeyword / filterAndGroupNodes)——搜索匹配 name/chapter/section、按章分组
 * ③ 组卷按知识点筛题的级联目录(curriculumGraphForSubject / chaptersOf / nodesInChapter)
 */
import { describe, expect, it } from 'vitest';
import type { KpGraphDto, KpNodeDto } from '@qiming/contracts';
import {
  chaptersOf,
  curriculumGraphForSubject,
  filterAndGroupNodes,
  graphsForSubject,
  nodeMatchesKeyword,
  nodesInChapter,
  resolveGraphForSubject,
} from '../kpTree';

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

const node = (id: number, name: string, extra: Partial<KpNodeDto> = {}): KpNodeDto => ({
  id, graphId: 1, code: `n${id}`, name,
  parentCode: null, level: null, category: null,
  grade: null, chapter: null, section: null,
  difficulty: null, examWeight: null, summary: null, content: null,
  ...extra,
});

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

describe('nodeMatchesKeyword(搜索范围 name/chapter/section)', () => {
  const n = node(1, '一次函数的图象', { chapter: '第十九章 一次函数', section: '19.2' });

  it('name / chapter / section 任一命中即匹配', () => {
    expect(nodeMatchesKeyword(n, '图象')).toBe(true);
    expect(nodeMatchesKeyword(n, '十九章')).toBe(true);
    expect(nodeMatchesKeyword(n, '19.2')).toBe(true);
  });

  it('都不命中 → 不匹配;空关键词(含全空白)→ 全匹配', () => {
    expect(nodeMatchesKeyword(n, '二次函数')).toBe(false);
    expect(nodeMatchesKeyword(n, '')).toBe(true);
    expect(nodeMatchesKeyword(n, '  ')).toBe(true);
  });

  it('chapter/section 为 null 时不炸,仅按 name 匹配', () => {
    const bare = node(2, '化学方程式');
    expect(nodeMatchesKeyword(bare, '方程式')).toBe(true);
    expect(nodeMatchesKeyword(bare, '第十九章')).toBe(false);
  });
});

describe('filterAndGroupNodes(过滤 + 按章节分组展示)', () => {
  const NODES = [
    node(1, '一次函数的概念', { chapter: '第十九章 一次函数' }),
    node(2, '一次函数的图象', { chapter: '第十九章 一次函数' }),
    node(3, '二次根式', { chapter: '第十六章 二次根式' }),
    node(4, '数形结合', { category: '思想方法' }),
    node(5, '孤儿节点'),
  ];

  it('按章节分组、组保序、组内保序;无 chapter 用 category,都没有归「其他」', () => {
    const groups = filterAndGroupNodes(NODES, '');
    expect(groups.map(([k]) => k)).toEqual(['第十九章 一次函数', '第十六章 二次根式', '思想方法', '其他']);
    expect(groups[0][1].map((n) => n.id)).toEqual([1, 2]);
  });

  it('关键词命中章节名 → 整章节点都保留(找知识点有章节路径感)', () => {
    const groups = filterAndGroupNodes(NODES, '十九章');
    expect(groups).toHaveLength(1);
    expect(groups[0][0]).toBe('第十九章 一次函数');
    expect(groups[0][1].map((n) => n.id)).toEqual([1, 2]);
  });

  it('关键词命中节点名 → 只留命中节点,但仍在其章节组下', () => {
    const groups = filterAndGroupNodes(NODES, '图象');
    expect(groups).toEqual([['第十九章 一次函数', [NODES[1]]]]);
  });

  it('无命中 → 空数组', () => {
    expect(filterAndGroupNodes(NODES, '不存在的词')).toEqual([]);
  });
});

describe('录题页「章节」候选按当前学科取图谱(EditorPage 口径)', () => {
  const phyNodes = [
    node(11, '牛顿第一定律', { graphId: 4, chapter: '第八章 运动和力' }),
    node(12, '二力平衡', { graphId: 4, chapter: '第八章 运动和力' }),
    node(13, '摩擦力', { graphId: 4, chapter: '第八章 运动和力' }),
  ];

  it('物理题:章节图谱=物理教材知识点(而非恒取第一张=数学),章节列表来自物理节点', () => {
    const graph = curriculumGraphForSubject(GRAPHS, '物理');
    expect(graph?.id).toBe(4);
    expect(graph?.subject).toBe('物理');
    expect(chaptersOf(phyNodes)).toEqual(['第八章 运动和力']);
  });

  it('该学科无教材图谱(如语文)→ 无章节候选,不回退数学章节', () => {
    expect(curriculumGraphForSubject(GRAPHS, '语文')).toBeUndefined();
  });
});

describe('组卷按知识点筛题的级联目录', () => {
  it('curriculumGraphForSubject:取该学科教材体系;没有 → undefined', () => {
    expect(curriculumGraphForSubject(GRAPHS, '物理')?.id).toBe(4);
    expect(curriculumGraphForSubject(GRAPHS, '语文')).toBeUndefined();
  });

  it('chaptersOf:章节去重保序,无 chapter 的节点不产生章节项', () => {
    const nodes = [
      node(1, 'a', { chapter: '第一章' }),
      node(2, 'b', { chapter: '第二章' }),
      node(3, 'c', { chapter: '第一章' }),
      node(4, 'd'),
    ];
    expect(chaptersOf(nodes)).toEqual(['第一章', '第二章']);
  });

  it('nodesInChapter:按章节收窄;chapter="" 返回全部(全部章节)', () => {
    const nodes = [node(1, 'a', { chapter: '第一章' }), node(2, 'b', { chapter: '第二章' })];
    expect(nodesInChapter(nodes, '第一章').map((n) => n.id)).toEqual([1]);
    expect(nodesInChapter(nodes, '').map((n) => n.id)).toEqual([1, 2]);
  });
});
