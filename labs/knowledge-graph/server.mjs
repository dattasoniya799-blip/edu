#!/usr/bin/env node
/**
 * 初中数理化知识图谱 —— 动态版:启动时直接读仓内 v2 图谱数据实时构图,
 * 不再依赖 Python 一步导出。接口行为对齐
 * /Users/apple1/Desktop/edu/_research/os-taxonomy/apps/server.mjs(只读参照)。
 *
 *   node server.mjs
 *   open http://127.0.0.1:8787
 *
 * 数据源:../../data/knowledge-graphs/v2/*.json（env KG_V2_DIR 可覆盖）。
 * fs.watch 监听该目录,文件变化 debounce 500ms 后重建;重建失败保留旧数据,
 * 并在 /api/stats 里报 lastError。
 *
 * Endpoints:
 *   GET /api/stats
 *   GET /api/graph?subject=&grade=&stage=&q=
 *   GET /api/topics/:id
 *   GET /api/topics/:id/ancestors
 *   GET /api/topics/:id/unlocks
 *   GET /api/frontier?known=
 *   GET /api/path?from=&to=
 *   GET /api/search?q=
 *   GET /api/clusters
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync, watch } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, buildTaxonomy } from './lib/taxonomy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const V2_DIR = resolve(process.env.KG_V2_DIR || join(HERE, '..', '..', 'data', 'knowledge-graphs', 'v2'));
const EXPLORER = join(HERE, 'explorer');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

// --- 内存态:每次重建整体替换,读接口不会看到半新半旧的数据 ---
let state = null; // { topics, byId, prereqsOf, unlocksOf, depsFile, manifest, stages, clustersFile }
let lastError = null;
let lastBuiltAt = null;

function loadV2Graphs() {
  const wanted = new Set(SOURCES.map((s) => s.file));
  const graphs = {};
  if (!existsSync(V2_DIR)) {
    throw new Error(`v2 目录不存在: ${V2_DIR}`);
  }
  const entries = readdirSync(V2_DIR, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue; // 跳过 mapping/ 等子目录
    if (!ent.name.endsWith('.json')) continue;
    if (!wanted.has(ent.name)) continue; // 只读 SOURCES 里登记的三份学科图
    graphs[ent.name] = JSON.parse(readFileSync(join(V2_DIR, ent.name), 'utf8'));
  }
  return graphs;
}

function indexTaxonomy(built) {
  const topics = built.topics.topics;
  const byId = new Map(topics.map((t) => [t.id, t]));
  const prereqsOf = new Map();
  const unlocksOf = new Map();
  for (const t of topics) {
    prereqsOf.set(t.id, []);
    unlocksOf.set(t.id, []);
  }
  for (const d of built.dependencies.dependencies) {
    if (!byId.has(d.topicId) || !byId.has(d.prerequisiteId)) continue;
    prereqsOf.get(d.topicId).push({ id: d.prerequisiteId, strength: d.strength, reason: d.reason });
    unlocksOf.get(d.prerequisiteId).push({ id: d.topicId, strength: d.strength, reason: d.reason });
  }
  return {
    topics,
    byId,
    prereqsOf,
    unlocksOf,
    depsFile: built.dependencies,
    clustersFile: built.clusters,
    manifest: built.manifest,
    stages: built.stages,
  };
}

function rebuild() {
  try {
    const graphs = loadV2Graphs();
    const built = buildTaxonomy(graphs);
    state = indexTaxonomy(built);
    lastError = null;
    lastBuiltAt = new Date().toISOString();
    console.log(
      `[kg] rebuilt  topics=${state.topics.length}  deps=${state.depsFile.dependencies.length}  ` +
        `clusters=${state.clustersFile.clusters.length}  at=${lastBuiltAt}`,
    );
  } catch (err) {
    lastError = { message: err.message, at: new Date().toISOString() };
    if (state) {
      console.error(`[kg] rebuild failed, keeping previous data: ${err.message}`);
    } else {
      console.error(`[kg] initial build failed: ${err.stack || err.message}`);
      throw err; // 启动时首次构图失败没有旧数据可用,直接终止
    }
  }
}

rebuild();

// --- fs.watch v2 目录, debounce 500ms 后重建 ---
let debounceTimer = null;
function scheduleRebuild() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    rebuild();
  }, 500);
}
try {
  watch(V2_DIR, { persistent: true }, (_eventType, filename) => {
    if (filename && !filename.endsWith('.json')) return;
    scheduleRebuild();
  });
  console.log(`[kg] watching ${V2_DIR}`);
} catch (err) {
  console.error(`[kg] fs.watch failed for ${V2_DIR}: ${err.message}`);
}

// --- 查询辅助(与旧 server.mjs 完全一致的行为) ---
function walk(start, adj) {
  const seen = new Set();
  const q = [start];
  while (q.length) {
    const x = q.pop();
    for (const n of adj.get(x) || []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      q.push(n.id);
    }
  }
  return seen;
}

function shortestPath(fromId, toId) {
  const { byId, unlocksOf } = state;
  if (!byId.has(fromId) || !byId.has(toId)) return null;
  if (fromId === toId) return [fromId];
  const prev = new Map();
  const q = [fromId];
  prev.set(fromId, null);
  while (q.length) {
    const x = q.shift();
    for (const n of unlocksOf.get(x) || []) {
      if (prev.has(n.id)) continue;
      prev.set(n.id, x);
      if (n.id === toId) {
        const path = [toId];
        let cur = toId;
        while (prev.get(cur)) {
          cur = prev.get(cur);
          path.push(cur);
        }
        return path.reverse();
      }
      q.push(n.id);
    }
  }
  return null;
}

function slim(t) {
  return {
    id: t.id,
    name: t.name,
    subject: t.subject,
    domain: t.domain,
    type: t.type,
    grade: t.grade,
    stage: t.stage,
    chapter: t.chapter,
    section: t.section,
    textbook: t.textbook,
    sourceCode: t.sourceCode,
    description: t.description,
    assessmentPrompt: t.assessmentPrompt,
    evidence: t.evidence || [],
    kpType: t.kpType,
    cognitiveLevel: t.cognitiveLevel,
    difficulty: t.difficulty,
    ageRangeStart: t.ageRangeStart,
    ageRangeEnd: t.ageRangeEnd,
    centrality: t.centrality,
  };
}

function full(t) {
  const { prereqsOf, unlocksOf, byId } = state;
  return {
    ...t,
    prerequisites: (prereqsOf.get(t.id) || []).map((p) => ({
      ...p,
      name: byId.get(p.id)?.name,
      subject: byId.get(p.id)?.subject,
      grade: byId.get(p.id)?.grade,
    })),
    unlocks: (unlocksOf.get(t.id) || []).map((p) => ({
      ...p,
      name: byId.get(p.id)?.name,
      subject: byId.get(p.id)?.subject,
      grade: byId.get(p.id)?.grade,
    })),
  };
}

function parseList(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchTopic(t, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    (t.name && t.name.toLowerCase().includes(s)) ||
    (t.description && t.description.toLowerCase().includes(s)) ||
    (t.sourceCode && t.sourceCode.toLowerCase().includes(s)) ||
    (t.chapter && t.chapter.toLowerCase().includes(s)) ||
    (t.domain && t.domain.toLowerCase().includes(s))
  );
}

function filterTopics(params) {
  const subjects = parseList(params.subject);
  const grades = parseList(params.grade);
  const stage = params.stage || '';
  const q = (params.q || '').trim();
  return state.topics.filter((t) => {
    if (subjects.length && !subjects.includes(t.subject)) return false;
    if (grades.length && !grades.includes(t.grade)) return false;
    if (stage && t.stage !== stage) return false;
    if (!matchTopic(t, q)) return false;
    return true;
  });
}

function json(res, code, body) {
  const raw = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(raw);
}

function query(url) {
  return Object.fromEntries(url.searchParams.entries());
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

function safeJoin(root, rel) {
  const p = normalize(join(root, rel));
  if (!p.startsWith(root)) return null;
  return p;
}

function serveFile(res, filePath) {
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const ext = extname(filePath).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(readFileSync(filePath));
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;

  if (!state) {
    return json(res, 503, { error: 'taxonomy not ready', lastError });
  }

  if (path === '/api/stats') {
    const { manifest, stages } = state;
    return json(res, 200, {
      ...manifest.counts,
      coverage: manifest.coverage,
      taxonomyVersion: manifest.taxonomyVersion,
      generatedAt: manifest.generatedAt,
      stages: stages.stages,
      lastBuiltAt,
      lastError,
    });
  }

  if (path === '/api/clusters') {
    return json(res, 200, state.clustersFile);
  }

  if (path === '/api/search') {
    const params = query(url);
    const q = (params.q || '').trim();
    if (!q) return json(res, 200, { query: q, results: [] });
    const hits = filterTopics(params).slice(0, 40).map(slim);
    return json(res, 200, { query: q, results: hits });
  }

  if (path === '/api/graph') {
    const params = query(url);
    const nodes = filterTopics(params);
    const idSet = new Set(nodes.map((t) => t.id));
    const links = [];
    for (const d of state.depsFile.dependencies) {
      if (idSet.has(d.topicId) && idSet.has(d.prerequisiteId)) {
        links.push({ source: d.prerequisiteId, target: d.topicId, strength: d.strength, reason: d.reason });
      }
    }
    return json(res, 200, { nodes: nodes.map(slim), links });
  }

  if (path === '/api/frontier') {
    const known = new Set(parseList(query(url).known));
    const frontier = state.topics.filter((t) => {
      if (known.has(t.id)) return false;
      const ps = state.prereqsOf.get(t.id) || [];
      const hard = ps.filter((p) => p.strength === 'hard');
      const need = hard.length ? hard : ps;
      return need.length === 0 || need.every((p) => known.has(p.id));
    });
    return json(res, 200, { count: frontier.length, topics: frontier.map(slim) });
  }

  if (path === '/api/path') {
    const params = query(url);
    const pathIds = shortestPath(params.from, params.to);
    if (!pathIds) return json(res, 404, { error: 'no path' });
    return json(res, 200, {
      from: params.from,
      to: params.to,
      path: pathIds.map((id) => slim(state.byId.get(id))),
    });
  }

  const topicMatch = path.match(/^\/api\/topics\/([^/]+)(?:\/(ancestors|unlocks))?$/);
  if (topicMatch) {
    const id = decodeURIComponent(topicMatch[1]);
    const t = state.byId.get(id);
    if (!t) return json(res, 404, { error: 'unknown topic' });
    if (topicMatch[2] === 'ancestors') {
      const ids = walk(id, state.prereqsOf);
      return json(res, 200, { id, count: ids.size, topics: [...ids].map((x) => slim(state.byId.get(x))) });
    }
    if (topicMatch[2] === 'unlocks') {
      const ids = walk(id, state.unlocksOf);
      return json(res, 200, { id, count: ids.size, topics: [...ids].map((x) => slim(state.byId.get(x))) });
    }
    return json(res, 200, full(t));
  }

  if (path === '/' || path === '/index.html') {
    return serveFile(res, join(EXPLORER, 'index.html'));
  }

  return serveFile(res, safeJoin(EXPLORER, path.replace(/^\//, '')));
});

server.listen(PORT, HOST, () => {
  console.log(
    `初中数理化知识图谱(动态)  http://${HOST}:${PORT}   ` +
      `${state.topics.length} topics / ${state.depsFile.dependencies.length} edges  ` +
      `源: ${V2_DIR}`,
  );
});
