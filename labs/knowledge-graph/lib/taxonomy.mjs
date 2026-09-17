/**
 * 纯函数:把 v2 初中数理化知识图谱（{metadata, sources, nodes[], edges[]}）
 * 在内存里变换成 Marble os-taxonomy 结构（topics / dependencies / clusters / stages / manifest）。
 *
 * 逐函数移植自 /Users/apple1/Desktop/edu/_lab/知识图谱v2/export_os_taxonomy.py
 * （只读参照，未改动）。只导出 level=3 知识点；前置边只保留两端都是知识点、
 * relation=prerequisite && level=point 的边。高中节点暂无数据。
 *
 * 与 Python 版本的差异只应有：
 *   - generatedAt（每次构图都是当下时间）
 *   - centrality 的极小浮点尾数（pagerank 累加顺序在两种语言里可能不完全一致）
 * 其余字段、集合、计数应逐项一致 —— 见 scripts/verify-parity.mjs。
 */

// SOURCES: 文件名 -> {slug, country, cname, version, url}。
// 顺序即 export() 里遍历三门学科的顺序，决定 topics/deps/curricula 数组的先后。
export const SOURCES = [
  {
    file: 'math_junior_pep_v2.json',
    slug: 'pep-math-2024',
    country: 'CN',
    cname: '人教版初中数学（2024）',
    version: '2024',
    url: 'https://www.pep.com.cn/',
  },
  {
    file: 'physics_junior_pep_v2.json',
    slug: 'pep-physics-2024',
    country: 'CN',
    cname: '人教版初中物理（2024）',
    version: '2024',
    url: 'https://www.pep.com.cn/',
  },
  {
    file: 'chemistry_junior_kyb_v2.json',
    slug: 'kyb-chemistry-2024',
    country: 'CN',
    cname: '科粤版初中化学（2024）',
    version: '2024',
    url: 'http://www.dzkbw.com/books/kyb/huaxue/',
  },
];

export const KP_TO_TYPE = {
  概念: 'CONCEPTUAL',
  规律: 'CONCEPTUAL',
  技能: 'PROCEDURAL',
  实验: 'PROCEDURAL',
  应用: 'PROCEDURAL',
};

export const AGE = {
  初一: [12, 13],
  初二: [13, 14],
  初三: [14, 15],
  高一: [15, 16],
  高二: [16, 17],
  高三: [17, 18],
};

export const COG_PROMPT = {
  了解: '能否用自己的话说出这个知识点在讲什么',
  理解: '能否解释它为什么成立、和相邻概念有什么区别',
  掌握: '能否独立完成典型题目并说出关键步骤',
  运用: '能否在新情境里选用这个知识点解决问题',
};

export function tid(code) {
  return `mt_${code}`;
}

export function stageOf(grade) {
  if (grade && String(grade).startsWith('高')) return 'senior';
  return 'junior';
}

export function inferType(n) {
  const kp = n.kp_type;
  if (kp && KP_TO_TYPE[kp]) return KP_TO_TYPE[kp];
  const name = n.name || '';
  if (['图像', '图象', '示意图', '数轴', '坐标系'].some((k) => name.includes(k))) {
    return 'REPRESENTATIONAL';
  }
  return 'CONCEPTUAL';
}

export function descriptionOf(n) {
  const summary = (n.summary || '').trim();
  if (summary) return summary;
  const bits = [n.name];
  if (n.chapter) bits.push(`所属${n.chapter}`);
  if (n.section) bits.push(`第 ${n.section} 节`);
  if (n.kp_type) bits.push(`类型：${n.kp_type}`);
  return bits.join('，') + '。';
}

export function evidenceOf(n) {
  const out = [];
  const content = n.content || {};
  for (const t of content.typical_tasks || []) {
    const s = String(t).trim();
    if (s) out.push(s);
  }
  for (const m of content.common_mistakes || []) {
    const s = String(m).trim();
    if (s) out.push(`能避免：${s}`);
  }
  const cog = n.cognitive_level;
  if (cog) {
    out.push(`课标层级「${cog}」：${COG_PROMPT[cog] || '能按该层级作答'}`);
  }
  if (n.kp_type === '实验' && !out.some((x) => x.includes('实验'))) {
    out.push('能独立完成相关实验操作，并说明步骤与注意事项');
  }
  if (out.length === 0) {
    out.push(`能用自己的话说出「${n.name}」的含义，并完成一道理应由它支撑的题目`);
  }
  // Marble evidence 通常 2-4 条;过长截一下
  return out.slice(0, 6);
}

export function assessmentOf(n) {
  const tasks = ((n.content || {}).typical_tasks || [])
    .map((t) => String(t).trim())
    .filter(Boolean);
  if (tasks.length) {
    const t0 = tasks[0];
    return '孩子会这个点，应该能' + (t0.startsWith('能') ? t0.slice(1) : '：' + t0);
  }
  const summary = (n.summary || '').trim();
  if (summary) return `孩子面对「${n.name}」时，能不能自己讲清楚：${summary}`;
  return `孩子面对「${n.name}」时，能不能自己讲清楚并做对相关题。`;
}

/**
 * PageRank in-memory over topic ids following the "prerequisite -> unlocks -> topic" direction
 * (edges: {topicId, prerequisiteId}); a=prerequisiteId 指向 b=topicId。
 * 数值与遍历顺序无关(只与图结构相关),但浮点求和顺序在极小尾数上可能与 Python 略有差异。
 */
export function pagerank(ids, edges, nIter = 30, d = 0.85) {
  const n = ids.length;
  if (n === 0) return {};
  const idx = new Map(ids.map((t, i) => [t, i]));
  const out = Array.from({ length: n }, () => []);
  const outdeg = new Array(n).fill(0);
  for (const e of edges) {
    const a = idx.has(e.prerequisiteId) ? idx.get(e.prerequisiteId) : undefined;
    const b = idx.has(e.topicId) ? idx.get(e.topicId) : undefined;
    if (a === undefined || b === undefined || a === b) continue;
    out[a].push(b);
    outdeg[a] += 1;
  }
  let pr = new Array(n).fill(1.0 / n);
  for (let iter = 0; iter < nIter; iter++) {
    const nxt = new Array(n).fill((1.0 - d) / n);
    let sink = 0.0;
    for (let i = 0; i < n; i++) {
      if (outdeg[i] === 0) {
        sink += (d * pr[i]) / n;
      } else {
        const share = (d * pr[i]) / outdeg[i];
        for (const j of out[i]) nxt[j] += share;
      }
    }
    for (let i = 0; i < n; i++) nxt[i] += sink;
    pr = nxt;
  }
  const mx = Math.max(...pr) || 1.0;
  const result = {};
  for (let i = 0; i < n; i++) result[ids[i]] = pr[i] / mx;
  return result;
}

export function clusterSummary(subject, domain, grade, points) {
  const n = points.length;
  const types = new Map();
  for (const p of points) {
    const k = p.kp_type || '未标类型';
    types.set(k, (types.get(k) || 0) + 1);
  }
  const typeS = [...types.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}${v}`)
    .join('、');
  const names = points.slice(0, 4).map((p) => p.name);
  const more = n > 4 ? '等' : '';
  return (
    `${grade}${subject}《${domain}》共 ${n} 个知识点（${typeS}）。` +
    `核心包括：${names.join('、')}${more}。` +
    '点击图谱中的节点可追溯必须先掌握的前置。'
  );
}

function cmpTuple(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * v2Graphs: { [filename]: {metadata, sources, nodes[], edges[]} }, 键为 SOURCES 里的 file 名。
 * 缺失的文件会被跳过(对应科目产出空)。
 *
 * 返回值形状与 Python export() 写盘的几个 JSON 完全对应(只是在内存里,不落盘):
 *   { topics, dependencies, clusters, curriculumStandards, sourceMap, manifest, stages }
 */
export function buildTaxonomy(v2Graphs) {
  const topics = [];
  const deps = [];
  const seenDep = new Set();
  const clusters = [];
  const curricula = [];
  const sourceMap = [];

  for (const src of SOURCES) {
    const g = v2Graphs[src.file];
    if (!g) continue;
    const nodes = g.nodes || [];
    const points = nodes.filter((n) => n.level === 3);
    const sections = nodes.filter((n) => n.level === 2);
    const pointCodes = new Set(points.map((n) => n.code));

    const stdTopics = sections.map((s) => ({
      key: `${src.slug}:${s.code}`,
      code: s.code,
      data: {
        name: s.name,
        chapter: s.chapter ?? null,
        section: s.section ?? null,
        textbook: s.textbook ?? null,
        grade: s.grade ?? null,
      },
    }));
    curricula.push({
      slug: src.slug,
      country: src.country,
      name: src.cname,
      version: src.version,
      sourceUrl: src.url,
      textIncluded: true,
      license: 'internal-toc-codes',
      topicCount: stdTopics.length,
      topics: stdTopics,
    });

    for (const n of points) {
      const [a0, a1] = AGE[n.grade] || [12, 15];
      const topic = {
        id: tid(n.code),
        type: inferType(n),
        subject: n.subject,
        domain: n.chapter || n.subject,
        name: n.name,
        description: descriptionOf(n),
        ageRangeStart: a0,
        ageRangeEnd: a1,
        centrality: null,
        evidence: evidenceOf(n),
        assessmentPrompt: assessmentOf(n),
        standards: n.parent_code ? [`${src.slug}:${n.parent_code}`] : [],
        sourceCode: n.code,
        grade: n.grade ?? null,
        textbook: n.textbook ?? null,
        chapter: n.chapter ?? null,
        section: n.section ?? null,
        kpType: n.kp_type ?? null,
        cognitiveLevel: n.cognitive_level ?? null,
        difficulty: n.difficulty ?? null,
        stage: stageOf(n.grade),
      };
      topics.push(topic);
      sourceMap.push({
        id: topic.id,
        sourceCode: n.code,
        graph: g.metadata?.code,
        legacyCode: n.legacy_code ?? null,
      });
    }

    for (const e of g.edges || []) {
      if (e.relation !== 'prerequisite') continue;
      if (e.level !== 'point') continue;
      const frm = e.from_code;
      const to = e.to_code;
      if (!pointCodes.has(frm) || !pointCodes.has(to) || frm === to) continue;
      const key = `${tid(to)}\u0000${tid(frm)}`;
      if (seenDep.has(key)) continue;
      seenDep.add(key);
      const kind = e.edge_kind || 'logic';
      let strength = e.strength || (kind === 'sequence' ? 'soft' : 'hard');
      if (strength !== 'hard' && strength !== 'soft') strength = 'hard';
      let reason = (e.rationale || '').trim() || null;
      if (kind === 'sequence' && !reason) reason = '教材节内讲授顺序衔接';
      deps.push({
        topicId: tid(to),
        prerequisiteId: tid(frm),
        strength,
        reason,
      });
    }

    const byCluster = new Map();
    for (const n of points) {
      const [a0] = AGE[n.grade] || [12, 15];
      const k = [n.subject, n.chapter || n.subject, a0, n.grade || ''];
      const kk = JSON.stringify(k);
      if (!byCluster.has(kk)) byCluster.set(kk, { key: k, pts: [] });
      byCluster.get(kk).pts.push(n);
    }
    const clusterEntries = [...byCluster.values()].sort((x, y) => cmpTuple(x.key, y.key));
    for (const { key, pts } of clusterEntries) {
      const [subject, domain, age0, grade] = key;
      clusters.push({
        subject,
        domain,
        ageRangeStart: age0,
        summary: clusterSummary(subject, domain, grade, pts),
      });
    }
  }

  const ids = topics.map((t) => t.id);
  const ranks = pagerank(ids, deps);
  for (const t of topics) {
    t.centrality = Math.round((ranks[t.id] ?? 0.0) * 1e6) / 1e6;
  }

  const topicsObj = { version: 'edu-v2', topicCount: topics.length, topics };
  const depsObj = {
    version: 'edu-v2',
    note: '`topicId` depends on `prerequisiteId`。level=3 知识点前置；logic 保留原 strength，sequence 记为 soft。',
    edgeCount: deps.length,
    dependencies: deps,
  };
  const clustersObj = { version: 'edu-v2', clusterCount: clusters.length, clusters };
  const standardsObj = {
    note: '标准条目是教材章/节目录码，不是课标原文。正文未收录。',
    codesOnlySources: [],
    curriculumCount: curricula.length,
    curricula,
  };

  const bySubject = {};
  const byGrade = {};
  for (const t of topics) {
    bySubject[t.subject] = (bySubject[t.subject] || 0) + 1;
    const g = t.grade || '未标';
    byGrade[g] = (byGrade[g] || 0) + 1;
  }

  const manifest = {
    dataset: '初高中数理化知识图谱',
    taxonomyVersion: 'edu-v2',
    generatedAt: new Date().toISOString(),
    schemaOrigin: 'Marble Skill Taxonomy v1 structure (withmarbleapp/os-taxonomy@96a7933); content replaced',
    codesOnlySources: [],
    coverage: {
      junior: {
        status: 'draft',
        grades: ['初一', '初二', '初三'],
        subjects: ['数学', '物理', '化学'],
        editions: { 数学: '人教版 2024', 物理: '人教版 2024', 化学: '科粤版 2024' },
      },
      senior: {
        status: 'empty',
        grades: ['高一', '高二', '高三'],
        subjects: ['数学', '物理', '化学'],
        note: '高中知识点尚未写入。图谱、接口与可视化已按初高中预留。',
      },
    },
    counts: {
      topics: topics.length,
      topicsBySubject: bySubject,
      topicsByGrade: byGrade,
      dependencies: deps.length,
      curricula: curricula.length,
      curriculumStandards: curricula.reduce((s, c) => s + c.topicCount, 0),
      topicStandardLinks: topics.reduce((s, t) => s + t.standards.length, 0),
      clusters: clusters.length,
    },
    excluded: [
      'embeddings',
      'student mastery (PII)',
      'senior-high knowledge points (not authored yet)',
      'cross-subject edges',
    ],
  };

  const stages = {
    stages: [
      { id: 'junior', name: '初中', grades: ['初一', '初二', '初三'], ageRange: [12, 15], status: 'draft' },
      { id: 'senior', name: '高中', grades: ['高一', '高二', '高三'], ageRange: [15, 18], status: 'empty' },
    ],
    subjects: [
      { id: '数学', edition: '人教版', junior: '2024 新版', senior: '待写入' },
      { id: '物理', edition: '人教版', junior: '2024 新版', senior: '待写入' },
      { id: '化学', edition: '科粤版', junior: '2024', senior: '待写入' },
    ],
  };

  return {
    topics: topicsObj,
    dependencies: depsObj,
    clusters: clustersObj,
    curriculumStandards: standardsObj,
    sourceMap: { note: 'os-taxonomy topic id ↔ v2 知识点 code', count: sourceMap.length, map: sourceMap },
    manifest,
    stages,
  };
}
