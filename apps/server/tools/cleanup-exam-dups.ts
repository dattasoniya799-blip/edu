/**
 * 真题重复清理工具(走运行中后端的 HTTP API,与 import-exams.ts 配套)
 * 背景: 旧版 import:exams 用 keyword contains 检索去重,LaTeX 题干检索不可靠,
 *   重跑导入会漏判重复造成重复入库;源文件题干修订后,旧版本题干也会残留成"近似重复"。
 * 逻辑: 以 <dir>/*.json 当前内容为真值 ——
 *   候选 = chapter 以任一卷源短标开头的题(即真题导入所建,不碰种子/手工题);
 *   保留 = 每个源题干(stemLatex 全等)最早入库的一行;
 *   删除 = 同题干多余行 + 题干已不在源文件中的旧版本行(走 DELETE /questions/:id 软删,
 *          被试卷引用的行服务端拒删 409 → 保留并警告)。
 * 用法: npx tsx tools/cleanup-exam-dups.ts [--base http://localhost:3000] [--phone 13800000002]
 *       [--password Teacher@123] [--dir data/exam-import] [--apply]
 *   默认 dry-run 只报告;加 --apply 才真删。结束报告"缺失题干"数,缺失的用 import:exams 补齐。
 */
import * as fs from 'fs';
import * as path from 'path';

// ---------------- 参数(与 import-exams.ts 同风格) ----------------

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
const APPLY = flag('apply');

function resolveDir(dir: string): string {
  const candidates = [path.resolve(dir), path.resolve(path.dirname(process.argv[1]), '../../..', dir)];
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
  console.error(`目录不存在: ${candidates.join(' 或 ')}`);
  process.exit(1);
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
    const err = new Error(`${method} ${pathname} → HTTP ${res.status} code=${env?.code}: ${msg ?? '未知错误'}`) as Error & { httpStatus?: number };
    err.httpStatus = res.status;
    throw err;
  }
  return env.data as T;
}

// ---------------- 主流程 ----------------

interface Row { id: number; stemLatex: string; chapter?: string | null; subject?: string; status?: string }

async function fetchAllQuestions(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 1; ; page++) {
    const data = await api<{ items: Row[]; total: number }>('GET', `/questions?size=50&page=${page}`);
    rows.push(...data.items);
    if (page * 50 >= data.total || data.items.length === 0) break;
  }
  return rows;
}

async function main() {
  const dir = resolveDir(DIR_ARG);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) { console.error(`目录 ${dir} 下没有 JSON 文件`); process.exit(1); }

  // 源真值: 当前题干集合 + 卷源短标集合(与 import-exams buildChapter 的 src 部分一致)
  const currentStems = new Set<string>();
  const sourceLabels = new Set<string>();
  for (const file of files) {
    const exam = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    sourceLabels.add(exam.year && exam.region ? `${exam.year}${exam.region}中考` : exam.sourceName);
    for (const q of exam.questions ?? []) if (q.stemLatex?.trim()) currentStems.add(q.stemLatex);
  }
  console.log(`目标: ${BASE}(${APPLY ? '真实删除' : 'dry-run,只报告'})  源: ${files.length} 卷 / ${currentStems.size} 题干 / 短标 ${sourceLabels.size} 个\n`);

  const login = await api<{ accessToken: string; me: { name: string; role: string } }>(
    'POST', '/auth/login', { phone: PHONE, password: PASSWORD });
  token = login.accessToken;
  console.log(`登录成功: ${login.me?.name ?? PHONE}(${login.me?.role ?? '?'})`);

  const all = await fetchAllQuestions();
  const isExamRow = (r: Row) => [...sourceLabels].some((s) => (r.chapter ?? '').startsWith(s));
  const candidates = all.filter(isExamRow);
  console.log(`现库题目 ${all.length},其中真题导入所建 ${candidates.length}\n`);

  // 每个源题干保留最早一行;其余候选行(含旧版本题干)进删除清单
  const keepByStem = new Map<string, Row>();
  for (const r of candidates) {
    if (!currentStems.has(r.stemLatex)) continue;
    const prev = keepByStem.get(r.stemLatex);
    if (!prev || r.id < prev.id) keepByStem.set(r.stemLatex, r);
  }
  const keepIds = new Set([...keepByStem.values()].map((r) => r.id));
  const toDelete = candidates.filter((r) => !keepIds.has(r.id));

  const dupRows = toDelete.filter((r) => currentStems.has(r.stemLatex));
  const staleRows = toDelete.filter((r) => !currentStems.has(r.stemLatex));
  console.log(`删除清单: ${toDelete.length} 行(完全重复 ${dupRows.length} + 源文件已修订的旧版题干 ${staleRows.length})`);
  for (const r of toDelete)
    console.log(`   - id=${r.id} [${r.subject ?? '?'}] ${(r.chapter ?? '').slice(0, 40)} :: ${r.stemLatex.slice(0, 30).replace(/\n/g, ' ')}…`);

  let deleted = 0, blocked = 0;
  if (APPLY) {
    console.log('');
    for (const r of toDelete) {
      try {
        await api('DELETE', `/questions/${r.id}`);
        deleted++;
      } catch (e) {
        blocked++;
        console.log(`   ⚠ id=${r.id} 删除被拒(保留): ${(e as Error).message}`);
      }
    }
  }

  const missing = [...currentStems].filter((s) => !keepByStem.has(s));
  console.log(`\n════════ 结果 ════════`);
  console.log(`  保留真题: ${keepByStem.size} / 源题干 ${currentStems.size}`);
  console.log(`  ${APPLY ? `已删除: ${deleted},被引用拒删: ${blocked}` : `待删除(dry-run): ${toDelete.length}`}`);
  if (missing.length > 0) {
    console.log(`  缺失题干 ${missing.length} 道(库里没有,跑 npm run import:exams 补齐):`);
    for (const s of missing) console.log(`   - ${s.slice(0, 40).replace(/\n/g, ' ')}…`);
  }
  if (blocked > 0) process.exit(2);
}

main().catch((e) => { console.error('执行失败:', (e as Error).message); process.exit(3); });
