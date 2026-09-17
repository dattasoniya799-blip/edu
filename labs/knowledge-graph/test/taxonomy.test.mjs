import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stageOf,
  inferType,
  evidenceOf,
  assessmentOf,
  pagerank,
  tid,
  buildTaxonomy,
} from '../lib/taxonomy.mjs';

test('tid: 加 mt_ 前缀', () => {
  assert.equal(tid('MATH-7A-01-01-01'), 'mt_MATH-7A-01-01-01');
});

test('stageOf: 高中年级判 senior, 其余(含空)判 junior', () => {
  assert.equal(stageOf('初一'), 'junior');
  assert.equal(stageOf('初三'), 'junior');
  assert.equal(stageOf('高一'), 'senior');
  assert.equal(stageOf('高三'), 'senior');
  assert.equal(stageOf(undefined), 'junior');
  assert.equal(stageOf(null), 'junior');
  assert.equal(stageOf(''), 'junior');
});

test('inferType: kp_type 命中映射表', () => {
  assert.equal(inferType({ kp_type: '概念', name: 'x' }), 'CONCEPTUAL');
  assert.equal(inferType({ kp_type: '规律', name: 'x' }), 'CONCEPTUAL');
  assert.equal(inferType({ kp_type: '技能', name: 'x' }), 'PROCEDURAL');
  assert.equal(inferType({ kp_type: '实验', name: 'x' }), 'PROCEDURAL');
  assert.equal(inferType({ kp_type: '应用', name: 'x' }), 'PROCEDURAL');
});

test('inferType: 无 kp_type 时按名称里的图像关键词判 REPRESENTATIONAL', () => {
  assert.equal(inferType({ name: '数轴上的点' }), 'REPRESENTATIONAL');
  assert.equal(inferType({ name: '函数图象的画法' }), 'REPRESENTATIONAL');
  assert.equal(inferType({ name: '坐标系的建立' }), 'REPRESENTATIONAL');
});

test('inferType: 都没命中时默认 CONCEPTUAL', () => {
  assert.equal(inferType({ name: '一般概念' }), 'CONCEPTUAL');
  assert.equal(inferType({}), 'CONCEPTUAL');
});

test('evidenceOf: typical_tasks + common_mistakes + cognitive_level 依次拼接', () => {
  const n = {
    name: '趋势图',
    kp_type: '技能',
    cognitive_level: '理解',
    content: {
      typical_tasks: ['能从折线图指出上升或下降', ' '],
      common_mistakes: ['把折线画断'],
    },
  };
  assert.deepEqual(evidenceOf(n), [
    '能从折线图指出上升或下降',
    '能避免：把折线画断',
    '课标层级「理解」：能否解释它为什么成立、和相邻概念有什么区别',
  ]);
});

test('evidenceOf: kp_type=实验 且没有实验相关条目时补一条兜底', () => {
  const n = { name: '测密度实验', kp_type: '实验', content: {} };
  const out = evidenceOf(n);
  assert.ok(out.some((x) => x.includes('实验')));
});

test('evidenceOf: 完全没有材料时用通用兜底文案', () => {
  const n = { name: '某知识点', content: {} };
  assert.deepEqual(evidenceOf(n), [
    '能用自己的话说出「某知识点」的含义，并完成一道理应由它支撑的题目',
  ]);
});

test('evidenceOf: 最多保留 6 条', () => {
  const n = {
    name: 'x',
    content: {
      typical_tasks: Array.from({ length: 10 }, (_, i) => `任务${i}`),
    },
  };
  assert.equal(evidenceOf(n).length, 6);
});

test('assessmentOf: 有 typical_tasks 且以「能」开头时去掉重复的「能」', () => {
  const n = { name: '正负数概念', content: { typical_tasks: ['能判断一个数是正数、负数还是 0'] } };
  assert.equal(assessmentOf(n), '孩子会这个点，应该能判断一个数是正数、负数还是 0');
});

test('assessmentOf: 有 typical_tasks 但不以「能」开头时补冒号', () => {
  const n = { name: 'x', content: { typical_tasks: ['判断正负'] } };
  assert.equal(assessmentOf(n), '孩子会这个点，应该能：判断正负');
});

test('assessmentOf: 无 typical_tasks 但有 summary 时走 summary 分支', () => {
  const n = { name: '趋势图', summary: '折线图看升降', content: {} };
  assert.equal(assessmentOf(n), '孩子面对「趋势图」时，能不能自己讲清楚：折线图看升降');
});

test('assessmentOf: 都没有时走通用兜底', () => {
  const n = { name: '某知识点', content: {} };
  assert.equal(assessmentOf(n), '孩子面对「某知识点」时，能不能自己讲清楚并做对相关题。');
});

test('pagerank: 空图返回空对象', () => {
  assert.deepEqual(pagerank([], []), {});
});

test('pagerank: 汇聚节点(两个前置都指向它)排名高于两个对称叶子节点', () => {
  const ids = ['a', 'b', 'c'];
  const edges = [
    { topicId: 'c', prerequisiteId: 'a' },
    { topicId: 'c', prerequisiteId: 'b' },
  ];
  const ranks = pagerank(ids, edges);
  assert.ok(ranks.c > ranks.a);
  assert.ok(ranks.c > ranks.b);
  assert.equal(ranks.a, ranks.b); // a、b 结构对称,排名应相等
  assert.equal(Math.max(...Object.values(ranks)), ranks.c); // 按 max 归一化
});

test('pagerank: 自环边(a==b)被忽略,不应报错或产生 NaN', () => {
  const ids = ['a'];
  const edges = [{ topicId: 'a', prerequisiteId: 'a' }];
  const ranks = pagerank(ids, edges);
  assert.equal(ranks.a, 1); // 单节点无有效边,归一化后为 1
});

// --- buildTaxonomy: 用一个小的合成 v2 图,覆盖端到端变换 ---
function fakeV2Graph() {
  return {
    metadata: { code: 'math_junior_pep_v2' },
    sources: [],
    nodes: [
      { code: 'M-01', name: '第一章', subject: '数学', level: 1, parent_code: '', grade: '初一' },
      {
        code: 'M-01-01',
        name: '第一节',
        subject: '数学',
        level: 2,
        parent_code: 'M-01',
        grade: '初一',
        chapter: '第一章',
        section: '1.1',
        textbook: '七年级上册',
      },
      {
        code: 'M-01-01-01',
        name: '知识点甲',
        subject: '数学',
        level: 3,
        parent_code: 'M-01-01',
        grade: '初一',
        chapter: '第一章',
        section: '1.1',
        textbook: '七年级上册',
        kp_type: '概念',
        cognitive_level: '理解',
        difficulty: 1,
        content: { typical_tasks: ['能说出甲是什么'] },
      },
      {
        code: 'M-01-01-02',
        name: '知识点乙',
        subject: '数学',
        level: 3,
        parent_code: 'M-01-01',
        grade: '初一',
        chapter: '第一章',
        section: '1.1',
        textbook: '七年级上册',
        kp_type: '技能',
        difficulty: 2,
        content: { typical_tasks: ['能用甲解决乙的问题'] },
      },
    ],
    edges: [
      { from_code: 'M-01', to_code: 'M-01-01', relation: 'parent_child', level: 'structure' },
      { from_code: 'M-01-01', to_code: 'M-01-01-01', relation: 'parent_child', level: 'structure' },
      {
        from_code: 'M-01-01-01',
        to_code: 'M-01-01-02',
        relation: 'prerequisite',
        level: 'point',
        edge_kind: 'logic',
        strength: 'hard',
        rationale: '先懂甲才能学乙',
      },
      // 非知识点前置边(section 级别)不应被计入 dependencies
      { from_code: 'M-01', to_code: 'M-01-01', relation: 'prerequisite', level: 'section' },
    ],
  };
}

test('buildTaxonomy: 只导出 level=3 知识点、正确挂载依赖与簇', () => {
  const built = buildTaxonomy({ 'math_junior_pep_v2.json': fakeV2Graph() });

  assert.equal(built.topics.topicCount, 2);
  const ids = built.topics.topics.map((t) => t.id);
  assert.deepEqual(ids.sort(), ['mt_M-01-01-01', 'mt_M-01-01-02']);

  assert.equal(built.dependencies.edgeCount, 1);
  const dep = built.dependencies.dependencies[0];
  assert.equal(dep.topicId, 'mt_M-01-01-02');
  assert.equal(dep.prerequisiteId, 'mt_M-01-01-01');
  assert.equal(dep.strength, 'hard');
  assert.equal(dep.reason, '先懂甲才能学乙');

  assert.equal(built.clusters.clusterCount, 1);
  assert.equal(built.clusters.clusters[0].subject, '数学');
  assert.equal(built.clusters.clusters[0].domain, '第一章');

  const topicA = built.topics.topics.find((t) => t.id === 'mt_M-01-01-01');
  assert.equal(topicA.stage, 'junior');
  assert.equal(topicA.type, 'CONCEPTUAL');
  assert.equal(topicA.standards[0], 'pep-math-2024:M-01-01');

  assert.equal(built.manifest.counts.topics, 2);
  assert.equal(built.manifest.counts.dependencies, 1);
  assert.equal(built.manifest.counts.clusters, 1);
  assert.ok(built.stages.stages.some((s) => s.id === 'junior'));
});

test('buildTaxonomy: 缺失的学科文件被跳过,不报错', () => {
  const built = buildTaxonomy({});
  assert.equal(built.topics.topicCount, 0);
  assert.equal(built.dependencies.edgeCount, 0);
  assert.equal(built.clusters.clusterCount, 0);
});
