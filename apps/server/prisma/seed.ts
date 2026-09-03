/**
 * W0-1 · Seed 脚本(两阶段)
 *   阶段 base    : 机构 + 管理员 + 2 教师 + 12 学生(2 台已绑设备) + AI 额度
 *   阶段 business: 课程/讲次/环节/资源/30 题(挂三维标签)/试卷/作业/全班作答/批改/错题/掌握度
 * 用法:
 *   npx tsx prisma/seed.ts --phase base
 *   npx tsx tools/import-kp.ts --org 1 --dir ../../data/knowledge-graphs   ← 先导入图谱
 *   npx tsx prisma/seed.ts --phase business
 * 数据为确定性生成(固定随机种子),便于 Gate-0 对账。
 * 密码哈希: scrypt(开发态);生产在 A1 任务切换为 argon2。演示密码统一 Admin@123 / Teacher@123
 */
import 'dotenv/config'; // 防止脚本误写默认库(波次1事故根因修复)
import { Client } from 'pg';
import { scryptSync, randomBytes } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { deflateSync } from 'zlib';

// ---------------- 演示文件(2026-09-02 走查 G-3:此前 seed 资源 / 作答照片的 ossKey 没有实体文件,预览 404、批改破图)----------------
/** 本地存储根(与 UploadService 同口径:UPLOAD_ROOT,缺省 ./storage 相对 apps/server) */
const STORAGE_ROOT = resolve(process.env.UPLOAD_ROOT ?? './storage');
function writeDemoFile(ossKey: string, data: Buffer): void {
  const target = resolve(STORAGE_ROOT, ossKey);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}
/** 生成一张纯色 + 边框的 PNG(无第三方依赖),给作答照片 / 板书图占位用 */
function demoPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8bit RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const edge = x < 6 || y < 6 || x >= width - 6 || y >= height - 6;
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = edge ? 60 : rgb[0]; raw[o + 1] = edge ? 60 : rgb[1]; raw[o + 2] = edge ? 60 : rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** 最小合法 PDF(一页,ASCII 文本),给「微课讲义」演示资源用 */
function demoPdf(lines: string[]): Buffer {
  const content = `BT /F1 20 Tf 60 720 Td ${lines.map((l, i) => `${i ? '0 -32 Td ' : ''}(${l.replace(/[()\\]/g, '')}) Tj`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const DB = process.env.DATABASE_URL ?? 'postgresql://qiming:qiming_dev@127.0.0.1:5432/qiming_dev';
const phase = process.argv[process.argv.indexOf('--phase') + 1] ?? 'base';

// 确定性伪随机
let rngState = 20260611;
const rnd = () => (rngState = (rngState * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

const hash = (pwd: string) => {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(pwd, salt, 32).toString('hex')}`;
};

const STUDENT_NAMES = ['林小满','周子航','吴佳怡','郑一鸣','许诺','王浩然','刘思琪','陈嘉树','赵雨桐','孙铭','黄子睿','李一诺'];

async function base(c: Client) {
  const org = await c.query(
    `INSERT INTO orgs(name, settings) VALUES ('鲸云演示机构',
      '{"ai":{"qaGuideOnly":true,"preGrading":true,"classCompanion":false,"diagnosis":false},"studentHours":{"start":"00:00","end":"23:59"}}')
     RETURNING id`);
  const orgId = org.rows[0].id;

  await c.query(`INSERT INTO users(org_id, role, name, phone, password_hash, teacher_no)
    VALUES ($1,'admin','王校长','13800000001',$2,'A-0001')`, [orgId, hash('Admin@123')]);
  const t1 = await c.query(`INSERT INTO users(org_id, role, name, phone, password_hash, teacher_no, profile)
    VALUES ($1,'teacher','张明','13800000002',$2,'T-0001','{"stage":"初中","subject":"数学"}') RETURNING id`, [orgId, hash('Teacher@123')]);
  await c.query(`INSERT INTO users(org_id, role, name, phone, password_hash, teacher_no, profile)
    VALUES ($1,'teacher','李雯','13800000003',$2,'T-0002','{"stage":"初中","subject":"数学"}')`, [orgId, hash('Teacher@123')]);

  for (let i = 0; i < STUDENT_NAMES.length; i++) {
    const s = await c.query(`INSERT INTO users(org_id, role, name, phone, student_no, status, profile)
      VALUES ($1,'student',$2,$3,$4,'active','{"grade":"初二"}') RETURNING id`,
      [orgId, STUDENT_NAMES[i], `1390000${String(i + 1).padStart(4, '0')}`, `S-${String(i + 1).padStart(4, '0')}`]);
    if (i < 2) await c.query(`INSERT INTO devices(org_id, student_id, device_fingerprint, device_name)
      VALUES ($1,$2,$3,$4)`, [orgId, s.rows[0].id, `fp-demo-${i + 1}`, i === 0 ? 'iPad (A2602)' : '小米平板 6']);
    else await c.query(`INSERT INTO login_tickets(org_id, student_id, token, expires_at)
      VALUES ($1,$2,$3, now() + interval '7 day')`, [orgId, s.rows[0].id, `tk_${randomBytes(16).toString('hex')}`]);
  }
  await c.query(`INSERT INTO ai_quotas(org_id, period, monthly_limit) VALUES ($1, to_char(now(),'YYYY-MM'), 3000)`, [orgId]);
  console.log(`✓ base 完成:org_id=${orgId},管理员 13800000001/Admin@123,教师 13800000002/Teacher@123`);
}

async function business(c: Client) {
  const orgId = (await c.query(`SELECT id FROM orgs ORDER BY id LIMIT 1`)).rows[0].id;
  const t1 = (await c.query(`SELECT id FROM users WHERE org_id=$1 AND teacher_no='T-0001'`, [orgId])).rows[0].id;
  const students = (await c.query(`SELECT id, name FROM users WHERE org_id=$1 AND role='student' ORDER BY id`, [orgId])).rows;

  // ---- 三维图谱节点取样(必须先 import-kp) ----
  const pep = (await c.query(`SELECT n.id, n.code, n.name FROM kp_nodes n JOIN kp_graphs g ON g.id=n.graph_id
    WHERE n.org_id=$1 AND g.graph_type='curriculum_knowledge' AND (n.chapter LIKE '%一次函数%' OR n.name LIKE '%一次函数%')
    ORDER BY n.id LIMIT 12`, [orgId])).rows;
  const abl = (await c.query(`SELECT n.id, n.code FROM kp_nodes n JOIN kp_graphs g ON g.id=n.graph_id
    WHERE n.org_id=$1 AND g.graph_type='problem_solving_ability' AND n.level=2 ORDER BY n.id LIMIT 10`, [orgId])).rows;
  const str = (await c.query(`SELECT n.id, n.code FROM kp_nodes n JOIN kp_graphs g ON g.id=n.graph_id
    WHERE n.org_id=$1 AND g.graph_type='problem_solving_strategy' AND n.level=2 ORDER BY n.id LIMIT 10`, [orgId])).rows;
  if (!pep.length || !abl.length || !str.length) throw new Error('请先运行 import-kp 导入三个图谱再执行 business 阶段');

  // ---- 课程 / 选课 / 讲次 ----
  const course = (await c.query(`INSERT INTO courses(org_id,name,class_type,subject,stage,teacher_id,total_lessons,status)
    VALUES ($1,'初二数学提高班','group','数学','初中',$2,15,'ongoing') RETURNING id`, [orgId, t1])).rows[0].id;
  const course2 = (await c.query(`INSERT INTO courses(org_id,name,class_type,subject,stage,teacher_id,total_lessons,status)
    VALUES ($1,'李一诺 · 数学培优','one_on_one','数学','初中',$2,16,'ongoing') RETURNING id`, [orgId, t1])).rows[0].id;
  for (const s of students) await c.query(
    `INSERT INTO course_students(org_id,course_id,student_id) VALUES ($1,$2,$3)`, [orgId, course, s.id]);
  const liYinuo = students.find((s: { name: string }) => s.name === '李一诺');
  if (liYinuo) await c.query(
    `INSERT INTO course_students(org_id,course_id,student_id) VALUES ($1,$2,$3)`, [orgId, course2, liYinuo.id]);

  const titles = ['一次函数的概念','函数的图象与性质','待定系数法求解析式','一次函数的图象平移','一次函数与方程、不等式','单元复习与测验'];
  const lessonIds: number[] = [];
  // 排期锚点相对当前时间(绝对日期跨期后会导致"下次上课"等 e2e 对账失效):
  // i=0..2 过去三周(finished)、i=3 昨天(ready)、i=4..5 未来(draft),每周一讲 06:00 UTC(+08 14:00)
  const lessonAnchor = new Date();
  lessonAnchor.setUTCHours(6, 0, 0, 0);
  lessonAnchor.setUTCDate(lessonAnchor.getUTCDate() - 22);
  // 提高班 total_lessons=15:前 6 讲有内容(1-3 finished / 4 ready / 5-6 draft),7-15 为空讲次(走查 G-3:此前只建 6 讲,
  // 课程卡「第 4/15 讲」与讲次列表不符,教师也编排不到第 7 讲以后)
  for (let i = 0; i < 15; i++) {
    const start = new Date(lessonAnchor);
    start.setUTCDate(start.getUTCDate() + i * 7);
    const end = new Date(start.getTime() + 2 * 3600e3);
    const status = i < 3 ? 'finished' : i === 3 ? 'ready' : 'draft';
    const r = await c.query(`INSERT INTO lessons(org_id,course_id,seq,title,scheduled_start,scheduled_end,status,prep_checklist)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [orgId, course, i + 1, i < titles.length ? `第${i + 1}讲 · ${titles[i]}` : `第${i + 1}讲`, start, end, status,
       JSON.stringify(i === 3 ? { warmup: true, lecture: true, practice: true, homework: false } : {})]);
    lessonIds.push(r.rows[0].id);
  }
  // 1v1 课程 total_lessons=16:同样生成空讲次(此前 0 条,教师端讲次列表为空、无法编排)
  for (let i = 0; i < 16; i++) {
    const start = new Date(lessonAnchor);
    start.setUTCDate(start.getUTCDate() + 1 + i * 7);
    start.setUTCHours(10, 0, 0, 0); // +08 18:00
    await c.query(`INSERT INTO lessons(org_id,course_id,seq,title,scheduled_start,scheduled_end,status,prep_checklist)
      VALUES ($1,$2,$3,$4,$5,$6,'draft','{}')`,
      [orgId, course2, i + 1, `第${i + 1}讲`, start, new Date(start.getTime() + 1.5 * 3600e3)]);
  }

  // ---- 资源 ----
  // S6(m1):ossKey 必须遵循 `${purpose}/${orgId}/…` 约定(见 upload/oss-key.util 归属校验:
  // 首段 purpose∈UPLOAD_PURPOSES、第二段=orgId)。此前 demo 数据用 `demo/courseware/*`,
  // 第二段是 'courseware' 而非 orgId,被 /uploads/view-url 与 assertOssKeyOwned 判为越权 → 403,
  // 连学生看被授权课件/含图题都 403。改为合法归属前缀 `resource/${orgId}/…`,授权路径不再 403;
  // 物理文件仍不在本地(演示无实体课件),下载端 readFile 缺失 → 404,前端可优雅降级。
  // 2026-09-02 走查 G-3 起写实体文件:互动课件直接用实验区已人审的单文件动画(零依赖 HTML,课堂沙箱 iframe 可跑),
  // 「微课视频」改为 PDF 讲义(最小合法 PDF),预览 / 下载 / 课堂下发都有真实内容。
  const animSrc = resolve(__dirname, '../../../labs/playground/public/animations/初中/一次函数参数实验.html');
  const res1Key = `resource/${orgId}/demo/translation.html`;
  if (existsSync(animSrc)) { mkdirSync(dirname(resolve(STORAGE_ROOT, res1Key)), { recursive: true }); copyFileSync(animSrc, resolve(STORAGE_ROOT, res1Key)); }
  else writeDemoFile(res1Key, Buffer.from('<!doctype html><meta charset="utf-8"><title>函数图象平移 · 动画演示</title><p style="font:16px sans-serif;padding:24px">演示课件占位(实验区动画文件缺失)。</p>', 'utf8'));
  const res1 = (await c.query(`INSERT INTO resources(org_id,owner_id,type,name,oss_key,size,meta)
    VALUES ($1,$2,'interactive','函数图象平移 · 动画演示',$3,$4,
            '{"pages":24,"checkpoints":[3,8,12,18,22]}') RETURNING id`,
    [orgId, t1, res1Key, existsSync(resolve(STORAGE_ROOT, res1Key)) ? statSync(resolve(STORAGE_ROOT, res1Key)).size : 0])).rows[0].id;
  const res2Key = `resource/${orgId}/demo/undetermined.pdf`;
  const pdf = demoPdf(['Undetermined Coefficients Method', 'y = kx + b: substitute two points,', 'solve k and b.', '(demo handout)']);
  writeDemoFile(res2Key, pdf);
  await c.query(`INSERT INTO resources(org_id,owner_id,type,name,oss_key,size,meta)
    VALUES ($1,$2,'pdf','待定系数法 · 微课讲义',$3,$4,'{"pages":1}')`,
    [orgId, t1, res2Key, pdf.length]);

  // ---- 30 道题(挂 知识点+能力+策略 三维标签) ----
  const qIds: number[] = [];
  for (let i = 0; i < 30; i++) {
    const type = (['single', 'single', 'blank', 'solution'] as const)[i % 4];
    // k 随 i/20 抬升:参数联合周期须 ≥30,否则 i=20..29 与 i=0..9 生成逐字节相同的题干(题库出现重复对)
    const k = 2 + (i % 5) + 5 * Math.floor(i / 20); const b = i % 2 ? 1 + (i % 4) : -(1 + (i % 4)); const d = 1 + (i % 4);
    const stem = type === 'solution'
      ? `将直线 $y=kx+b$ 向下平移 $${d}$ 个单位后恰好经过点 $A(1,${k + b})$ 与点 $B(-1,${-k + b})$,求原直线的解析式。(写出完整过程)`
      : type === 'blank'
      ? `一次函数的图象经过点 $(1, ${k + b})$ 和 $(-1, ${-k + b})$,则该函数的解析式为 ________。`
      : `将直线 $y=${k}x${b >= 0 ? '+' + b : b}$ 向下平移 $${d}$ 个单位长度后,所得直线的解析式为(  )`;
    const answer = type === 'single' ? { choice: 'B' }
      : type === 'blank' ? { texts: [`y=${k}x${b >= 0 ? '+' + b : b}`] }
      : { referenceLatex: `设平移后直线 $y=kx+b'$,代入两点得 $k=${k},\\ b'=${b}$;还原:$b=${b}+${d}$,原直线 $y=${k}x${b + d >= 0 ? '+' + (b + d) : b + d}$。` };
    const rubric = type === 'solution'
      ? [{ step: 1, desc: '设式并代入两点', score: 3 }, { step: 2, desc: '求出平移后直线', score: 4 }, { step: 3, desc: '正确还原平移方向', score: 3 }] : [];
    const q = (await c.query(`INSERT INTO questions(org_id,owner_id,type,stage,subject,textbook_version,chapter,
        stem_latex,answer,rubric,analysis_latex,difficulty,status)
      VALUES ($1,$2,$3,'初中','数学','人教版','第十九章 一次函数',$4,$5,$6,$7,$8,'published') RETURNING id`,
      [orgId, t1, type, stem, JSON.stringify(answer), JSON.stringify(rubric),
       type === 'single'
         ? `平移口诀:上加下减(改 $b$)。本题 $b$ 由 $${b}$ 变化 $${d}$ 个单位。`
         : type === 'blank'
         ? `待定系数法:设 $y=kx+b$,把两点代入得方程组,解得 $k=${k},\\ b=${b}$。`
         : `先用待定系数法求平移后直线 $y=${k}x${b >= 0 ? '+' + b : b}$,再按「下移 $${d}$ 个单位 = $b$ 减 $${d}$」反向还原,原直线 $b=${b}+${d}$。`,
       1 + (i % 3)])).rows[0].id;
    qIds.push(q);
    if (type === 'single') {
      const opts = [`y=${k}x${b + d >= 0 ? '+' + (b + d) : b + d}`, `y=${k}x${b - d >= 0 ? '+' + (b - d) : b - d}`,
                    `y=${k + d}x${b >= 0 ? '+' + b : b}`, `y=${-k}x${b >= 0 ? '+' + b : b}`];
      for (let j = 0; j < 4; j++) await c.query(
        `INSERT INTO question_options(org_id,question_id,label,content_latex,is_correct) VALUES ($1,$2,$3,$4,$5)`,
        [orgId, q, 'ABCD'[j], `$${opts[j]}$`, j === 1]);
    }
    for (const nodeId of [pep[i % pep.length].id, abl[i % abl.length].id, str[i % str.length].id])
      await c.query(`INSERT INTO question_tags(org_id,question_id,node_id) VALUES ($1,$2,$3)`, [orgId, q, nodeId]);
  }

  // ---- 第 4 讲环节编排(课后作业缺位,对应 checklist=false) ----
  const practicePaper = (await c.query(`INSERT INTO papers(org_id,creator_id,name,type,total_score,status)
    VALUES ($1,$2,'第4讲 · 随堂练','practice',30,'published') RETURNING id`, [orgId, t1])).rows[0].id;
  for (let j = 0; j < 5; j++) await c.query(
    `INSERT INTO paper_questions(org_id,paper_id,question_id,seq,score) VALUES ($1,$2,$3,$4,$5)`,
    [orgId, practicePaper, qIds[j], j + 1, j === 4 ? 10 : 5]);
  // 第4讲 lecture 段逐页讲义(B6 真实模式课件区下发;buildCourseware 读 config.pages)
  const lecturePages = [
    { title: '函数图象的平移:先看“形”',
      body: '一次函数 $y=kx+b$ 的图象是一条直线。**平移**只改变直线的位置,不改变它的倾斜程度——斜率 $k$ 始终不变。',
      narration: '这一讲我们研究直线的上下平移:斜率不变,只动截距 b。' },
    { title: '平移规律:上加下减',
      body: '直线 $y=kx+b$ 沿 $y$ 轴方向平移:\n\n- 向上平移 $m$ 个单位 → $y=kx+(b+m)$\n- 向下平移 $m$ 个单位 → $y=kx+(b-m)$\n\n口诀:**上加下减**(变化的永远是截距 $b$)。',
      narration: '记住口诀:上加下减,改的是 b,k 不动。' },
    { title: '例题:求平移后的解析式',
      body: '将 $y=2x+1$ 向下平移 $3$ 个单位。\n\n解:$b$ 由 $1$ 变为 $1-3=-2$,所以平移后为 $y=2x-2$。',
      narration: '下移 3 个单位,b 减 3,得到 y=2x−2。' },
    { title: '随堂检验',
      body: '想一想:把 $y=-x+4$ 向上平移 $2$ 个单位,解析式是什么?',
      narration: '用口诀算一算,选出答案。',
      quiz: { stem: '把 $y=-x+4$ 向上平移 $2$ 个单位,得到?',
        options: [{ label: 'A', contentLatex: '$y=-x+6$' }, { label: 'B', contentLatex: '$y=-x+2$' },
                  { label: 'C', contentLatex: '$y=-x-2$' }, { label: 'D', contentLatex: '$y=x+6$' }],
        correct: 'A', hint: '上移 → b 加 2,$4+2=6$。' } },
  ];
  const segs: [string, number, any, number | null, number | null][] = [
    ['warmup', 10, { source: 'auto_wrong', count: 3 }, null, null],
    ['lecture', 35, { checkpoints: [3, 8, 12, 18, 22], pages: lecturePages }, res1, null],
    ['practice', 30, { ai_guide: true, stuck_alert_min: 3 }, null, practicePaper],
    ['summary', 25, { personal_consolidation: { min: 2, max: 4 } }, null, null]];
  // lecture / practice / summary 归入单元 1 并挂知识点(走查 G-3:此前三段无知识点,编排页三处「建议补全:未选择知识点」)
  const unitKp = pep.find((n: any) => /平移/.test(n.name)) ?? pep.find((n: any) => /图象与性质/.test(n.name)) ?? pep[0];
  for (let j = 0; j < segs.length; j++) await c.query(
    `INSERT INTO lesson_segments(org_id,lesson_id,seq,type,duration_min,config,resource_id,paper_id,kp_node_id,unit_seq)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [orgId, lessonIds[3], j + 1, segs[j][0], segs[j][1], JSON.stringify(segs[j][2]), segs[j][3], segs[j][4],
     segs[j][0] === 'warmup' ? null : unitKp.id, segs[j][0] === 'warmup' ? null : 1]);

  // ---- 第 3 讲课后作业:发布 + 全班作答 + 批改 + 错题 + 掌握度 ----
  const hwPaper = (await c.query(`INSERT INTO papers(org_id,creator_id,name,type,total_score,status)
    VALUES ($1,$2,'第3讲课后作业 · 待定系数法','homework',35,'published') RETURNING id`, [orgId, t1])).rows[0].id;
  const hwQs = [qIds[8], qIds[9], qIds[10], qIds[12], qIds[3]]; // 4 客观 + 1 解答(qIds[3] 为 solution)
  for (let j = 0; j < hwQs.length; j++) await c.query(
    `INSERT INTO paper_questions(org_id,paper_id,question_id,seq,score) VALUES ($1,$2,$3,$4,$5)`,
    [orgId, hwPaper, hwQs[j], j + 1, j === 4 ? 10 : 5]);
  // teacher_id = 授课教师 t1(与迁移 0002 回填规则一致:lesson→course→teacher)
  const assignment = (await c.query(`INSERT INTO assignments(org_id,paper_id,lesson_id,teacher_id,kind,target,publish_at,due_at,grading_policy)
    VALUES ($1,$2,$3,$4,'homework',$5, now() - interval '3 day', now() - interval '1 day', '{"objective":"instant","subjective":"ai_pre_review"}') RETURNING id`,
    [orgId, hwPaper, lessonIds[2], t1, JSON.stringify({ courseId: Number(course) })])).rows[0].id;

  const qTypes = (await c.query(`SELECT id, type, answer FROM questions WHERE id = ANY($1)`, [hwQs])).rows;
  const typeOf = new Map(qTypes.map((r: any) => [String(r.id), r]));
  let totalAnswers = 0, totalWrong = 0;
  for (const s of students) {
    const at = (await c.query(`INSERT INTO attempts(org_id,assignment_id,student_id,status,submitted_at,duration_sec)
      VALUES ($1,$2,$3,'graded', now() - interval '20 hour', $4) RETURNING id`,
      [orgId, assignment, s.id, 900 + Math.floor(rnd() * 900)])).rows[0].id;
    let obj = 0, subj = 0;
    for (let j = 0; j < hwQs.length; j++) {
      const meta: any = typeOf.get(String(hwQs[j]));
      const correct = rnd() < 0.78;
      let response: any, isCorrect: boolean | null = correct, score = 0;
      if (meta.type === 'single') { response = { choice: correct ? 'B' : 'ACD'[Math.floor(rnd() * 3)] }; score = correct ? 5 : 0; obj += score; }
      else if (meta.type === 'blank') { response = { texts: correct ? meta.answer.texts : ['y=x+1'] }; score = correct ? 5 : 0; obj += score; }
      // S6:答题原稿 photoOssKey 同样遵循 `answer_photo/${orgId}/…` 归属约定(否则教师批改签名端软失败不出图)
      else {
        const photoKey = `answer_photo/${orgId}/demo/${at}-${j}.png`;
        writeDemoFile(photoKey, demoPng(480, 320, [246, 243, 236])); // 演示「手写原稿」:米白纸面 + 深框
        response = { photoOssKey: photoKey }; isCorrect = null; score = 0;
      }
      const ans = (await c.query(`INSERT INTO answers(org_id,attempt_id,question_id,response,is_correct,score,time_spent_sec)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [orgId, at, hwQs[j], JSON.stringify(response), isCorrect, score, 60 + Math.floor(rnd() * 240)])).rows[0].id;
      totalAnswers++;
      if (meta.type === 'solution') {
        const aiScore = 4 + Math.floor(rnd() * 7);
        // attempt 已 graded ⇒ 解答题必已复核(真实流程 finalize 会被 4501 拦住);此前 70% 「已出分但未复核」是自相矛盾的数据,
        // 复核页显示「未判分 · 已复核」。统一为已复核:复核分 = 预批分,落到 answers.score 并计入总分(走查 G-3)
        const reviewed = true;
        rnd(); // 保持随机序列与旧 seed 一致(下游到课/错题分布不变)
        await c.query(`UPDATE answers SET score=$2 WHERE id=$1`, [ans, aiScore]); subj += aiScore;
        await c.query(`INSERT INTO grading_records(org_id,answer_id,ai_score,ai_steps,ai_error_tags,final_score,reviewer_id,comment,reviewed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [orgId, ans, aiScore,
           JSON.stringify([{ step: 1, ok: true }, { step: 2, ok: aiScore >= 7 }, { step: 3, ok: aiScore >= 9, comment: aiScore < 9 ? '还原方向错误' : '' }]),
           JSON.stringify(aiScore < 9 ? ['还原平移方向'] : []),
           reviewed ? aiScore : null, reviewed ? t1 : null,
           reviewed ? '前两步扎实,注意还原是反向操作。' : null, reviewed ? new Date() : null]);
      }
      if (isCorrect === false) {
        totalWrong++;
        await c.query(`INSERT INTO wrong_book_entries(org_id,student_id,question_id,source_answer_id,error_tags)
          VALUES ($1,$2,$3,$4,'["图象平移符号"]') ON CONFLICT (student_id,question_id) DO UPDATE SET wrong_count = wrong_book_entries.wrong_count + 1`,
          [orgId, s.id, hwQs[j], ans]);
      }
    }
    await c.query(`UPDATE attempts SET objective_score=$2, subjective_score=$3, score=$4 WHERE id=$1`,
      [at, obj, subj, obj + subj]);
  }

  // ---- 掌握度快照(规则:按学生×题目标签的客观题正确率) ----
  await c.query(`
    INSERT INTO mastery_snapshots(org_id, student_id, node_id, mastery, sample_count)
    SELECT a.org_id, at.student_id, qt.node_id,
           round(100.0 * sum(case when a.is_correct then 1 else 0 end) / count(*))::int,
           count(*)::int
    FROM answers a
    JOIN attempts at ON at.id = a.attempt_id
    JOIN question_tags qt ON qt.question_id = a.question_id
    WHERE a.is_correct IS NOT NULL
    GROUP BY a.org_id, at.student_id, qt.node_id
    ON CONFLICT (student_id, node_id) DO UPDATE SET mastery = EXCLUDED.mastery, sample_count = EXCLUDED.sample_count`);

  // ---- AI 计量样例 + 审计 ----
  for (let i = 0; i < 8; i++) await c.query(
    `INSERT INTO ai_calls(org_id,feature,user_id,course_id,lesson_id,provider,model,tokens_in,tokens_out,cost,latency_ms)
     VALUES ($1,$2,$3,$4,$5,'demo-llm','demo-model-s',$6,$7,$8,$9)`,
    [orgId, (['qa', 'pre_grading', 'qa', 'diagnosis'] as const)[i % 4], students[i % 12].id, course, lessonIds[2],
     800 + i * 137, 220 + i * 53, (0.012 + i * 0.003).toFixed(4), 900 + i * 120]);
  await c.query(`INSERT INTO audit_logs(org_id,actor_id,action,target_type,detail)
    VALUES ($1,(SELECT id FROM users WHERE org_id=$1 AND role='admin' LIMIT 1),'seed.business','system','{"note":"演示数据生成"}')`, [orgId]);

  console.log(`✓ business 完成:课程2 讲次${lessonIds.length}+16 题目30 作答${totalAnswers} 错题${totalWrong} 演示文件已写入 ${STORAGE_ROOT}`);
}

(async () => {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { await c.query('BEGIN'); phase === 'base' ? await base(c) : await business(c); await c.query('COMMIT'); }
  catch (e) { await c.query('ROLLBACK'); console.error('seed 失败,已回滚:', e); process.exit(1); }
  finally { await c.end(); }
})();
