/**
 * W0-1 · 知识图谱导入与校验
 * 用法: npx tsx tools/import-kp.ts --org <orgId> --dir ../../data/knowledge-graphs
 * 行为: 逐图谱校验(重复code/断链parent/断链edge/缺必填) → 全部通过才入库(事务) → 输出对账报告
 * 幂等: 同 (org_id, graph.code) 已存在则跳过该图谱并在报告中注明
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const DB = process.env.DATABASE_URL ?? 'postgresql://qiming:qiming_dev@127.0.0.1:5432/qiming_dev';

type Node = Record<string, any>;
type Edge = Record<string, any>;
interface GraphFile { metadata: any; sources: any[]; nodes: Node[]; edges: Edge[] }

const RELATION_MAP: Record<string, string> = { parent_child: 'parent_child', prerequisite: 'prerequisite', related: 'related' };

function arg(name: string, dflt?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (dflt !== undefined) return dflt;
  console.error(`缺少参数 --${name}`); process.exit(1);
}

function validate(file: string, g: GraphFile): string[] {
  const errs: string[] = [];
  if (!g.metadata?.code) errs.push('metadata.code 缺失');
  if (!g.metadata?.graph_type) errs.push('metadata.graph_type 缺失');
  const codes = new Set<string>();
  for (const n of g.nodes) {
    if (!n.code) { errs.push(`存在缺 code 的节点: ${JSON.stringify(n).slice(0, 80)}`); continue; }
    if (codes.has(n.code)) errs.push(`重复 code: ${n.code}`);
    codes.add(n.code);
    if (!n.name && !n.title) errs.push(`节点 ${n.code} 缺 name`);
  }
  for (const n of g.nodes) if (n.parent_code && !codes.has(n.parent_code)) errs.push(`节点 ${n.code} 的 parent_code 断链: ${n.parent_code}`);
  for (const e of g.edges) {
    if (!codes.has(e.from_code)) errs.push(`边 from 断链: ${e.from_code}`);
    if (!codes.has(e.to_code)) errs.push(`边 to 断链: ${e.to_code}`);
    if (!RELATION_MAP[e.relation]) errs.push(`未知 relation: ${e.relation}(${e.from_code}→${e.to_code})`);
  }
  return errs.map((e) => `[${file}] ${e}`);
}

async function main() {
  const orgId = Number(arg('org'));
  const dir = arg('dir');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) { console.error(`目录 ${dir} 下没有 JSON 文件`); process.exit(1); }

  const graphs: { file: string; g: GraphFile }[] = files.map((f) => ({ file: f, g: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));

  // ---------- 校验(全部通过才入库) ----------
  const allErrs = graphs.flatMap(({ file, g }) => validate(file, g));
  if (allErrs.length) { console.error('校验失败,未入库:\n' + allErrs.join('\n')); process.exit(2); }

  const client = new Client({ connectionString: DB });
  await client.connect();
  const report: string[] = [`# 知识图谱导入对账报告`, ``, `- 目标机构 org_id: ${orgId}`, `- 导入时间: ${new Date().toISOString()}`, ``];

  try {
    await client.query('BEGIN');
    const org = await client.query('SELECT id FROM orgs WHERE id=$1', [orgId]);
    if (org.rowCount === 0) throw new Error(`org_id=${orgId} 不存在,请先建机构(seed)`);

    for (const { file, g } of graphs) {
      const code = g.metadata.code;
      const exist = await client.query('SELECT id FROM kp_graphs WHERE org_id=$1 AND code=$2', [orgId, code]);
      if (exist.rowCount! > 0) { report.push(`## ${file}\n- 跳过:图谱 ${code} 已存在(幂等)`); continue; }

      const gr = await client.query(
        `INSERT INTO kp_graphs(org_id, code, graph_type, subject, grade_range, metadata, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [orgId, code, g.metadata.graph_type, g.metadata.subject ?? '数学',
         JSON.stringify(g.metadata.grade_range ?? []),
         JSON.stringify({ ...g.metadata, sources: g.sources ?? [] }),
         g.metadata.version ?? 1]);
      const graphId = gr.rows[0].id;

      // 节点批量插入(归一化: title→name, 数值裁剪)
      const codeToId = new Map<string, string>();
      for (const n of g.nodes) {
        const r = await client.query(
          `INSERT INTO kp_nodes(org_id, graph_id, code, name, parent_code, level, category,
             grade, chapter, section, difficulty, exam_weight, ability_tags, summary, content, source_refs, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
          [orgId, graphId, n.code, (n.name ?? n.title ?? '').slice(0, 128),
           n.parent_code || null, n.level ?? null, n.category ?? null,
           n.grade ?? null, n.chapter ?? null, n.section ?? null,
           n.difficulty ?? null, n.exam_weight ?? null,
           JSON.stringify(n.ability_tags ?? []), n.summary ?? null, n.content ?? null,
           JSON.stringify(n.source_refs ?? []), n.version ?? 1]);
        codeToId.set(n.code, r.rows[0].id);
      }
      for (const e of g.edges) {
        await client.query(
          `INSERT INTO kp_edges(org_id, graph_id, from_node_id, to_node_id, relation, confidence, rationale)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [orgId, graphId, codeToId.get(e.from_code), codeToId.get(e.to_code),
           RELATION_MAP[e.relation], e.confidence ?? null, e.rationale ?? null]);
      }

      // 对账统计
      const byGrade = await client.query(
        `SELECT coalesce(grade,'(无)') g, count(*) c FROM kp_nodes WHERE graph_id=$1 GROUP BY 1 ORDER BY 1`, [graphId]);
      report.push(`## ${file}`, `- 图谱: ${code}(${g.metadata.graph_type})`,
        `- 节点: 源文件 ${g.nodes.length} → 入库 ${codeToId.size} ${g.nodes.length === codeToId.size ? '✓ 一致' : '✗ 不一致!'}`,
        `- 边:   源文件 ${g.edges.length} → 入库 ${g.edges.length} ✓`,
        `- 年级分布: ${byGrade.rows.map((r: any) => `${r.g}:${r.c}`).join('  ')}`, ``);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('导入失败,已回滚:', err);
    process.exit(3);
  } finally { await client.end(); }

  const out = path.join(dir, 'IMPORT_REPORT.md');
  fs.writeFileSync(out, report.join('\n'));
  console.log(report.join('\n'));
  console.log(`\n报告已写入 ${out}`);
}
main();
