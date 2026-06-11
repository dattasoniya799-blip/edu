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
import { Client } from 'pg';
import { scryptSync, randomBytes } from 'crypto';

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
    `INSERT INTO orgs(name, settings) VALUES ('启明演示机构',
      '{"ai":{"qaGuideOnly":true,"preGrading":true},"studentHours":{"start":"06:00","end":"22:30"},"deviceBinding":true}')
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
  await c.query(`INSERT INTO courses(org_id,name,class_type,subject,stage,teacher_id,total_lessons,status)
    VALUES ($1,'李一诺 · 数学培优','one_on_one','数学','初中',$2,16,'ongoing')`, [orgId, t1]);
  for (const s of students) await c.query(
    `INSERT INTO course_students(org_id,course_id,student_id) VALUES ($1,$2,$3)`, [orgId, course, s.id]);

  const titles = ['一次函数的概念','函数的图象与性质','待定系数法求解析式','一次函数的图象平移','一次函数与方程、不等式','单元复习与测验'];
  const lessonIds: number[] = [];
  for (let i = 0; i < 6; i++) {
    const start = new Date(Date.UTC(2026, 4, 23, 6, 0)); // 2026-05-23(周六) 14:00 +08
    start.setUTCDate(start.getUTCDate() + i * 7);
    const end = new Date(start.getTime() + 2 * 3600e3);
    const status = i < 3 ? 'finished' : i === 3 ? 'ready' : 'draft';
    const r = await c.query(`INSERT INTO lessons(org_id,course_id,seq,title,scheduled_start,scheduled_end,status,prep_checklist)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [orgId, course, i + 1, `第${i + 1}讲 · ${titles[i]}`, start, end, status,
       JSON.stringify(i === 3 ? { warmup: true, lecture: true, practice: true, homework: false } : {})]);
    lessonIds.push(r.rows[0].id);
  }

  // ---- 资源 ----
  const res1 = (await c.query(`INSERT INTO resources(org_id,owner_id,type,name,oss_key,meta)
    VALUES ($1,$2,'interactive','函数图象平移 · 动画演示','demo/courseware/translation.html',
            '{"pages":24,"checkpoints":[3,8,12,18,22]}') RETURNING id`, [orgId, t1])).rows[0].id;
  await c.query(`INSERT INTO resources(org_id,owner_id,type,name,oss_key,meta)
    VALUES ($1,$2,'video','待定系数法 · 微课视频','demo/video/undetermined.mp4','{"durationSec":756}')`, [orgId, t1]);

  // ---- 30 道题(挂 知识点+能力+策略 三维标签) ----
  const qIds: number[] = [];
  for (let i = 0; i < 30; i++) {
    const type = (['single', 'single', 'blank', 'solution'] as const)[i % 4];
    const k = 2 + (i % 5); const b = i % 2 ? 1 + (i % 4) : -(1 + (i % 4)); const d = 1 + (i % 4);
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
       `平移口诀:上加下减(改 $b$)。本题 $b$ 由 $${b}$ 变化 $${d}$ 个单位。`, 1 + (i % 3)])).rows[0].id;
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
  const segs: [string, number, any, number | null, number | null][] = [
    ['warmup', 10, { source: 'auto_wrong', count: 3 }, null, null],
    ['lecture', 35, { checkpoints: [3, 8, 12, 18, 22] }, res1, null],
    ['practice', 30, { ai_guide: true, stuck_alert_min: 3 }, null, practicePaper],
    ['summary', 25, { personal_consolidation: { min: 2, max: 4 } }, null, null]];
  for (let j = 0; j < segs.length; j++) await c.query(
    `INSERT INTO lesson_segments(org_id,lesson_id,seq,type,duration_min,config,resource_id,paper_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [orgId, lessonIds[3], j + 1, segs[j][0], segs[j][1], JSON.stringify(segs[j][2]), segs[j][3], segs[j][4]]);

  // ---- 第 3 讲课后作业:发布 + 全班作答 + 批改 + 错题 + 掌握度 ----
  const hwPaper = (await c.query(`INSERT INTO papers(org_id,creator_id,name,type,total_score,status)
    VALUES ($1,$2,'第3讲课后作业 · 待定系数法','homework',35,'published') RETURNING id`, [orgId, t1])).rows[0].id;
  const hwQs = [qIds[8], qIds[9], qIds[10], qIds[12], qIds[3]]; // 4 客观 + 1 解答(qIds[3] 为 solution)
  for (let j = 0; j < hwQs.length; j++) await c.query(
    `INSERT INTO paper_questions(org_id,paper_id,question_id,seq,score) VALUES ($1,$2,$3,$4,$5)`,
    [orgId, hwPaper, hwQs[j], j + 1, j === 4 ? 10 : 5]);
  const assignment = (await c.query(`INSERT INTO assignments(org_id,paper_id,lesson_id,kind,target,due_at,grading_policy)
    VALUES ($1,$2,$3,'homework',$4, now() - interval '1 day', '{"objective":"instant","subjective":"ai_pre_review"}') RETURNING id`,
    [orgId, hwPaper, lessonIds[2], JSON.stringify({ courseId: Number(course) })])).rows[0].id;

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
      else { response = { photoOssKey: `demo/answers/${at}-${j}.jpg` }; isCorrect = null; score = 0; }
      const ans = (await c.query(`INSERT INTO answers(org_id,attempt_id,question_id,response,is_correct,score,time_spent_sec)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [orgId, at, hwQs[j], JSON.stringify(response), isCorrect, score, 60 + Math.floor(rnd() * 240)])).rows[0].id;
      totalAnswers++;
      if (meta.type === 'solution') {
        const aiScore = 4 + Math.floor(rnd() * 7);
        const reviewed = rnd() < 0.3;
        await c.query(`INSERT INTO grading_records(org_id,answer_id,ai_score,ai_steps,ai_error_tags,final_score,reviewer_id,comment,reviewed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [orgId, ans, aiScore,
           JSON.stringify([{ step: 1, ok: true }, { step: 2, ok: aiScore >= 7 }, { step: 3, ok: aiScore >= 9, comment: aiScore < 9 ? '还原方向错误' : '' }]),
           JSON.stringify(aiScore < 9 ? ['还原平移方向'] : []),
           reviewed ? aiScore : null, reviewed ? t1 : null,
           reviewed ? '前两步扎实,注意还原是反向操作。' : null, reviewed ? new Date() : null]);
        subj += aiScore;
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

  console.log(`✓ business 完成:课程2 讲次6 题目30 作答${totalAnswers} 错题${totalWrong}`);
}

(async () => {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { await c.query('BEGIN'); phase === 'base' ? await base(c) : await business(c); await c.query('COMMIT'); }
  catch (e) { await c.query('ROLLBACK'); console.error('seed 失败,已回滚:', e); process.exit(1); }
  finally { await c.end(); }
})();
