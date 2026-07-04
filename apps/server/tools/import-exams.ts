/**
 * 真题导入工具(走运行中后端的 HTTP API,不直连数据库、不影响 :3000 进程)
 * 用法: npm run import:exams -- [--base http://localhost:3000] [--phone 13800000002]
 *       [--password Teacher@123] [--dir data/exam-import] [--dry-run]
 * 输入: <dir>/*.json,每文件一套卷:
 *   { subject, sourceName, year, region, sourceUrl, questions: [{ type: single|multi|blank|solution,
 *     stemLatex, options?[{key,textLatex}], answer({choice}|{choices}|{texts}|{referenceLatex}),
 *     analysisLatex?, difficulty?(1-5), chapter?, kpKeywords?[] }] }
 * 契约要点(openapi QuestionInput + question.service 校验):
 *   - 必填: type/stage/subject/stemLatex/answer;difficulty 契约为 1-3(源 1-5 在此折算);
 *   - 选择题 options 必填(label/contentLatex/isCorrect,single 恰 1 个正确);
 *   - 解答题 rubric 必填(≥1 步);
 *   - tagNodeIds 必填且至少 1 个教材知识点(curriculum_knowledge)——该学科若无图谱/无匹配节点,
 *     题目无法通过服务端校验,只能记失败并附原因(subject/chapter 仍是检索字段,但契约不允许无 kp 标签);
 *   - POST /questions 存为草稿,需再 POST /questions/{id}/publish 入库(published)。
 * 幂等: 导入前 GET /questions?keyword=<题干前18字>(stemLatex contains 检索),
 *   命中 stemLatex 完全相同的题则跳过。
 */
import * as fs from 'fs';
import * as path from 'path';

// ---------------- 参数 ----------------

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return dflt;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const PHONE = arg('phone', '13800000002');
const PASSWORD = arg('password', 'Teacher@123');
const DIR_ARG = arg('dir', 'data/exam-import');
const DRY_RUN = flag('dry-run');

/** 目录解析: 先按 cwd,再按仓库根(tools/ 的上三级),与 npm run(cwd=apps/server)兼容 */
function resolveDir(dir: string): string {
  const candidates = [path.resolve(dir), path.resolve(path.dirname(process.argv[1]), '../../..', dir)];
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
  console.error(`目录不存在: ${candidates.join(' 或 ')}`);
  process.exit(1);
}

// ---------------- 输入/契约类型 ----------------

interface SourceQuestion {
  type: 'single' | 'multi' | 'blank' | 'solution';
  stemLatex: string;
  options?: { key: string; textLatex: string }[];
  answer: { choice?: string; choices?: string[]; texts?: string[]; referenceLatex?: string };
  analysisLatex?: string;
  difficulty?: number; // 源 1-5
  chapter?: string;
  kpKeywords?: string[];
}
interface ExamFile {
  subject: string;
  sourceName: string;
  year?: number;
  region?: string;
  sourceUrl?: string;
  questions: SourceQuestion[];
}
interface KpNode { id: number; name: string; chapter: string | null; section: string | null }
interface QuestionInput {
  type: string;
  stage: string;
  subject: string;
  textbookVersion?: string;
  chapter?: string;
  stemLatex: string;
  options?: { label: string; contentLatex: string; isCorrect?: boolean }[];
  answer: Record<string, unknown>;
  rubric?: { step: number; desc: string; score: number }[];
  analysisLatex?: string;
  difficulty?: number; // 契约 1-3
  tagNodeIds?: number[];
}

// ---------------- HTTP(统一信封 {code,message,data}) ----------------

let token = '';
async function api<T = any>(method: string, pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let env: any;
  try { env = await res.json(); } catch { throw new Error(`HTTP ${res.status} ${method} ${pathname}(非 JSON 响应)`); }
  if (!res.ok || env.code !== 0) {
    const msg = Array.isArray(env?.message) ? env.message.join('; ') : env?.message;
    throw new Error(`${method} ${pathname} → HTTP ${res.status} code=${env?.code}: ${msg ?? '未知错误'}`);
  }
  return env.data as T;
}

// ---------------- 字段映射 ----------------

/** 源难度 1-5 → 契约 1-3(1-2→1,3→2,4-5→3;缺省 2) */
function mapDifficulty(d?: number): number {
  if (d == null || !Number.isFinite(d)) return 2;
  return d <= 2 ? 1 : d === 3 ? 2 : 3;
}

/** chapter = 卷源短标 + 题目章节,如 "2024内蒙古包头中考 · 二次函数" */
function buildChapter(exam: ExamFile, q: SourceQuestion): string {
  const src = exam.year && exam.region ? `${exam.year}${exam.region}中考` : exam.sourceName;
  return (q.chapter ? `${src} · ${q.chapter}` : src).slice(0, 120);
}

/** 解答题 rubric:解析按空行/换行可拆 2-3 步则拆步给分(总 10 分),否则单步满分 */
function buildRubric(q: SourceQuestion): { step: number; desc: string; score: number }[] {
  const segs = (q.analysisLatex ?? '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 3);
  if (segs.length >= 2) {
    const scores = segs.length === 2 ? [5, 5] : [3, 3, 4];
    return segs.map((s, i) => ({ step: i + 1, desc: s.slice(0, 80), score: scores[i] }));
  }
  return [{ step: 1, desc: '完整解答:过程正确、结果正确', score: 10 }];
}

/**
 * kp 匹配:kpKeywords 逐词与 curriculum 节点的 name/chapter/section 做包含匹配,
 * 按匹配强度排序(name 全等 > name 包含关键词/关键词包含 name > chapter/section 包含关键词),
 * 兜底用题目 chapter 再匹配一轮;取前 1-2 个 nodeId。
 */
function matchKpNodes(nodes: KpNode[], q: SourceQuestion): number[] {
  const scored = new Map<number, number>();
  const tryWord = (word: string, weightBase: number) => {
    const w = word.trim();
    if (!w) return;
    for (const n of nodes) {
      let s = 0;
      if (n.name === w) s = weightBase + 3;
      else if (n.name.includes(w) || w.includes(n.name)) s = weightBase + 2;
      else if ((n.chapter ?? '').includes(w) || (n.section ?? '').includes(w)) s = weightBase + 1;
      if (s > (scored.get(n.id) ?? 0)) scored.set(n.id, s);
    }
  };
  for (const kw of q.kpKeywords ?? []) tryWord(kw, 10);
  if (scored.size === 0 && q.chapter) tryWord(q.chapter, 0); // 兜底:题目章节
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => id);
}

/** 单题映射为契约 QuestionInput;映射不合法时抛错(计入失败) */
function toQuestionInput(exam: ExamFile, q: SourceQuestion, kpNodes: KpNode[] | null): QuestionInput {
  if (!['single', 'multi', 'blank', 'solution'].includes(q.type)) throw new Error(`未知题型 ${q.type}`);
  if (!q.stemLatex?.trim()) throw new Error('stemLatex 为空');

  // options + answer
  let options: QuestionInput['options'];
  let answer: Record<string, unknown>;
  if (q.type === 'single' || q.type === 'multi') {
    const correct = q.type === 'single' ? [q.answer.choice].filter(Boolean) as string[] : q.answer.choices ?? [];
    if (correct.length === 0) throw new Error('选择题 answer 缺 choice/choices');
    options = (q.options ?? []).map((o) => ({ label: o.key, contentLatex: o.textLatex, isCorrect: correct.includes(o.key) }));
    if (options.length < 2) throw new Error('选择题 options 少于 2 项');
    if (options.filter((o) => o.isCorrect).length !== correct.length) throw new Error('answer 的选项 key 与 options 不匹配');
    answer = q.type === 'single' ? { choice: correct[0] } : { choices: correct };
  } else if (q.type === 'blank') {
    if (!Array.isArray(q.answer.texts) || q.answer.texts.length === 0) throw new Error('填空题 answer.texts 为空');
    answer = { texts: q.answer.texts };
  } else {
    if (!q.answer.referenceLatex?.trim()) throw new Error('解答题 answer.referenceLatex 为空');
    answer = { referenceLatex: q.answer.referenceLatex };
  }

  // tagNodeIds(契约硬性要求 ≥1 教材知识点,无法满足即失败)
  if (!kpNodes) throw new Error(`学科「${exam.subject}」无 curriculum 图谱,契约要求 tagNodeIds ≥1 教材知识点,无法导入`);
  const tagNodeIds = matchKpNodes(kpNodes, q);
  if (tagNodeIds.length === 0)
    throw new Error(`kpKeywords[${(q.kpKeywords ?? []).join(',')}] 未匹配到任何图谱节点(契约要求 tagNodeIds 必填)`);

  return {
    type: q.type,
    stage: '初中',
    subject: exam.subject,
    chapter: buildChapter(exam, q),
    stemLatex: q.stemLatex,
    ...(options ? { options } : {}),
    answer,
    ...(q.type === 'solution' ? { rubric: buildRubric(q) } : {}),
    ...(q.analysisLatex ? { analysisLatex: q.analysisLatex } : {}),
    difficulty: mapDifficulty(q.difficulty),
    tagNodeIds,
  };
}

// ---------------- 幂等查重 ----------------

/** 题干前 18 字作 keyword(stemLatex contains 检索),命中完全相同 stemLatex 即视为已存在 */
async function findExisting(stemLatex: string): Promise<number | null> {
  const prefix = stemLatex.slice(0, 18);
  const data = await api<{ items: { id: number; stemLatex: string }[]; total: number }>(
    'GET', `/questions?keyword=${encodeURIComponent(prefix)}&size=50`);
  const hit = data.items.find((it) => it.stemLatex === stemLatex);
  return hit ? hit.id : null;
}

// ---------------- 主流程 ----------------

interface FileStat { file: string; total: number; imported: number; skipped: number; failed: number; errors: string[] }

async function main() {
  const dir = resolveDir(DIR_ARG);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) { console.error(`目录 ${dir} 下没有 JSON 文件`); process.exit(1); }
  console.log(`目标: ${BASE}(${DRY_RUN ? 'dry-run,不写库' : '真实导入'})  目录: ${dir}  文件: ${files.length} 个\n`);

  // 登录(教师)
  const login = await api<{ accessToken: string; me: { name: string; role: string } }>(
    'POST', '/auth/login', { phone: PHONE, password: PASSWORD });
  token = login.accessToken;
  console.log(`登录成功: ${login.me?.name ?? PHONE}(${login.me?.role ?? '?'})\n`);

  // curriculum 图谱节点缓存(按学科);无图谱学科 → null
  const graphs = await api<{ id: number; graphType: string; subject: string }[]>('GET', '/kp/graphs');
  const nodeCache = new Map<string, KpNode[] | null>();
  async function nodesFor(subject: string): Promise<KpNode[] | null> {
    if (!nodeCache.has(subject)) {
      const g = graphs.find((x) => x.graphType === 'curriculum_knowledge' && x.subject === subject);
      nodeCache.set(subject, g ? await api<KpNode[]>('GET', `/kp/nodes?graphId=${g.id}`) : null);
    }
    return nodeCache.get(subject)!;
  }

  const stats: FileStat[] = [];
  for (const file of files) {
    let exam: ExamFile;
    try {
      exam = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (!exam.subject || !exam.sourceName || !Array.isArray(exam.questions)) throw new Error('缺 subject/sourceName/questions');
    } catch (e) {
      stats.push({ file, total: 0, imported: 0, skipped: 0, failed: 1, errors: [`文件解析失败: ${(e as Error).message}`] });
      continue;
    }
    const st: FileStat = { file, total: exam.questions.length, imported: 0, skipped: 0, failed: 0, errors: [] };
    const kpNodes = await nodesFor(exam.subject);
    console.log(`── ${file}(${exam.sourceName},${exam.questions.length} 题)`);

    for (let i = 0; i < exam.questions.length; i++) {
      const label = `第${i + 1}题(${exam.questions[i].type})`;
      try {
        const input = toQuestionInput(exam, exam.questions[i], kpNodes);
        const dupId = await findExisting(input.stemLatex);
        if (dupId != null) {
          st.skipped++;
          console.log(`   ↷ ${label} 跳过:已存在 id=${dupId}`);
          continue;
        }
        if (DRY_RUN) {
          st.imported++;
          console.log(`   ✓ ${label} [dry-run] 将导入 tags=[${input.tagNodeIds!.join(',')}] difficulty=${input.difficulty}`);
          continue;
        }
        const created = await api<{ id: number }>('POST', '/questions', input);
        try {
          await api('POST', `/questions/${created.id}/publish`);
        } catch (e) {
          throw new Error(`已建草稿 id=${created.id} 但发布失败: ${(e as Error).message}`);
        }
        st.imported++;
        console.log(`   ✓ ${label} 导入 id=${created.id}(published) tags=[${input.tagNodeIds!.join(',')}]`);
      } catch (e) {
        st.failed++;
        st.errors.push(`${label}: ${(e as Error).message}`);
        console.log(`   ✗ ${label} 失败: ${(e as Error).message}`);
      }
    }
    console.log(`   小计: 导入 ${st.imported} / 跳过 ${st.skipped} / 失败 ${st.failed}\n`);
    stats.push(st);
  }

  // 总表
  console.log('════════ 导入总表 ════════');
  let ti = 0, ts = 0, tf = 0;
  for (const s of stats) {
    ti += s.imported; ts += s.skipped; tf += s.failed;
    console.log(`  ${s.file}  题数 ${s.total}  导入 ${s.imported}  跳过 ${s.skipped}  失败 ${s.failed}`);
    for (const e of s.errors) console.log(`      - ${e}`);
  }
  console.log(`  合计: 导入 ${ti}  跳过 ${ts}  失败 ${tf}${DRY_RUN ? '(dry-run,未写库)' : ''}`);
  if (tf > 0) process.exit(2);
}

main().catch((e) => { console.error('执行失败:', (e as Error).message); process.exit(3); });
