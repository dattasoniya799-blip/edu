#!/usr/bin/env node
/**
 * 对拍:用移植后的 buildTaxonomy() 跑一遍 v2 图谱,与 Python 导出脚本
 * (/Users/apple1/Desktop/edu/_lab/知识图谱v2/export_os_taxonomy.py，只读参照)
 * 曾经写盘的基准结果逐项比对:
 *   /Users/apple1/Desktop/edu/_research/os-taxonomy/data/{topics,dependencies,clusters}.json
 *
 * 比对范围:
 *   - topics 数量与 id 集合
 *   - 每个 topic 的 name/subject/domain/type/grade/stage/chapter/section/
 *     description/assessmentPrompt/evidence/kpType/cognitiveLevel/difficulty
 *   - dependencies 数量与 (topicId, prerequisiteId, strength) 三元组集合
 *   - clusters 数量与 (subject, domain) 集合
 *
 * 已知允许有差异、不算失败的字段:
 *   - manifest.generatedAt(每次运行都是当下时间,与本脚本比对无关,不读取)
 *   - topic.centrality(pagerank 浮点尾数;两种语言的加法顺序不保证逐位相同)
 *
 * 用法: node scripts/verify-parity.mjs [--v2-dir=DIR] [--baseline-dir=DIR]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, buildTaxonomy } from '../lib/taxonomy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const V2_DIR = resolve(args['v2-dir'] || process.env.KG_V2_DIR || join(ROOT, '..', '..', 'data', 'knowledge-graphs', 'v2'));
const BASELINE_DIR = resolve(args['baseline-dir'] || join(ROOT, '..', '..', '..', '_research', 'os-taxonomy', 'data'));

function loadV2Graphs(dir) {
  const wanted = new Set(SOURCES.map((s) => s.file));
  const graphs = {};
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile() || !ent.name.endsWith('.json') || !wanted.has(ent.name)) continue;
    graphs[ent.name] = JSON.parse(readFileSync(join(dir, ent.name), 'utf8'));
  }
  return graphs;
}

function loadJSON(dir, name) {
  return JSON.parse(readFileSync(join(dir, name), 'utf8'));
}

const FIELDS = [
  'name',
  'subject',
  'domain',
  'type',
  'grade',
  'stage',
  'chapter',
  'section',
  'description',
  'assessmentPrompt',
  'evidence',
  'kpType',
  'cognitiveLevel',
  'difficulty',
];

function diffArraysAsSets(aArr, bArr, label) {
  const a = new Set(aArr);
  const b = new Set(bArr);
  const onlyA = [...a].filter((x) => !b.has(x));
  const onlyB = [...b].filter((x) => !a.has(x));
  const ok = onlyA.length === 0 && onlyB.length === 0;
  return { ok, label, count_new: aArr.length, count_baseline: bArr.length, onlyInNew: onlyA.slice(0, 20), onlyInBaseline: onlyB.slice(0, 20) };
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  console.log(`[parity] v2 数据源: ${V2_DIR}`);
  console.log(`[parity] 基准数据: ${BASELINE_DIR}`);

  const graphs = loadV2Graphs(V2_DIR);
  const built = buildTaxonomy(graphs);

  const baseTopics = loadJSON(BASELINE_DIR, 'topics.json');
  const baseDeps = loadJSON(BASELINE_DIR, 'dependencies.json');
  const baseClusters = loadJSON(BASELINE_DIR, 'clusters.json');

  const report = { ok: true, sections: [] };
  const fail = (msg) => {
    report.ok = false;
    report.sections.push({ ok: false, msg });
  };
  const pass = (msg) => {
    report.sections.push({ ok: true, msg });
  };

  // --- topics: 数量 + id 集合 ---
  const newTopics = built.topics.topics;
  const baseTopicsArr = baseTopics.topics;
  if (newTopics.length === baseTopicsArr.length) {
    pass(`topics 数量一致: ${newTopics.length}`);
  } else {
    fail(`topics 数量不一致: 新=${newTopics.length} 基准=${baseTopicsArr.length}`);
  }
  const idDiff = diffArraysAsSets(newTopics.map((t) => t.id), baseTopicsArr.map((t) => t.id), 'topic ids');
  if (idDiff.ok) pass('topic id 集合一致');
  else fail(`topic id 集合不一致: onlyInNew=${idDiff.onlyInNew.length} onlyInBaseline=${idDiff.onlyInBaseline.length} 示例=${JSON.stringify(idDiff.onlyInNew.slice(0, 5))}/${JSON.stringify(idDiff.onlyInBaseline.slice(0, 5))}`);

  // --- topics: 逐字段比对 ---
  const baseById = new Map(baseTopicsArr.map((t) => [t.id, t]));
  const fieldMismatches = {};
  for (const f of FIELDS) fieldMismatches[f] = [];
  let centralityDeltaMax = 0;
  let comparedCount = 0;
  for (const t of newTopics) {
    const b = baseById.get(t.id);
    if (!b) continue;
    comparedCount++;
    for (const f of FIELDS) {
      if (!deepEqual(t[f], b[f])) fieldMismatches[f].push({ id: t.id, new: t[f], base: b[f] });
    }
    if (typeof t.centrality === 'number' && typeof b.centrality === 'number') {
      centralityDeltaMax = Math.max(centralityDeltaMax, Math.abs(t.centrality - b.centrality));
    }
  }
  let anyFieldFail = false;
  for (const f of FIELDS) {
    if (fieldMismatches[f].length === 0) {
      pass(`字段 ${f} 一致(共比对 ${comparedCount} 个 topic)`);
    } else {
      anyFieldFail = true;
      fail(`字段 ${f} 有 ${fieldMismatches[f].length} 处不一致，示例: ${JSON.stringify(fieldMismatches[f][0])}`);
    }
  }
  if (!anyFieldFail) pass(`全部 ${FIELDS.length} 个字段在 ${comparedCount} 个 topic 上完全一致`);
  report.sections.push({
    ok: true,
    msg: `centrality 最大绝对误差 = ${centralityDeltaMax}（pagerank 浮点尾数，允许差异，不计入 ok）`,
  });

  // --- dependencies: 数量 + 三元组集合 ---
  const newDeps = built.dependencies.dependencies;
  const baseDepsArr = baseDeps.dependencies;
  if (newDeps.length === baseDepsArr.length) pass(`dependencies 数量一致: ${newDeps.length}`);
  else fail(`dependencies 数量不一致: 新=${newDeps.length} 基准=${baseDepsArr.length}`);
  const depKey = (d) => `${d.topicId}\u0000${d.prerequisiteId}\u0000${d.strength}`;
  const depDiff = diffArraysAsSets(newDeps.map(depKey), baseDepsArr.map(depKey), 'dep triples');
  if (depDiff.ok) pass('(topicId, prerequisiteId, strength) 三元组集合一致');
  else fail(`三元组集合不一致: onlyInNew=${depDiff.onlyInNew.length} onlyInBaseline=${depDiff.onlyInBaseline.length}`);

  // --- clusters: 数量 + (subject, domain) 集合 ---
  const newClusters = built.clusters.clusters;
  const baseClustersArr = baseClusters.clusters;
  if (newClusters.length === baseClustersArr.length) pass(`clusters 数量一致: ${newClusters.length}`);
  else fail(`clusters 数量不一致: 新=${newClusters.length} 基准=${baseClustersArr.length}`);
  const clusterKey = (c) => `${c.subject}\u0000${c.domain}`;
  const clusterDiff = diffArraysAsSets(newClusters.map(clusterKey), baseClustersArr.map(clusterKey), 'cluster keys');
  if (clusterDiff.ok) pass('(subject, domain) 集合一致');
  else fail(`(subject, domain) 集合不一致: onlyInNew=${JSON.stringify(clusterDiff.onlyInNew)} onlyInBaseline=${JSON.stringify(clusterDiff.onlyInBaseline)}`);

  console.log('');
  for (const s of report.sections) {
    console.log(`${s.ok ? '✅' : '❌'} ${s.msg}`);
  }
  console.log('');
  console.log(report.ok ? '[parity] 结果: 一致（除 generatedAt / centrality 浮点尾数外）' : '[parity] 结果: 存在差异，见上');
  process.exit(report.ok ? 0 : 1);
}

main();
