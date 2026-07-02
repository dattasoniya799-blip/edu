/**
 * D4 压测入口:模拟「1 教师 + N 学生」真实负载。
 *
 * 用法(在 apps/server 下):
 *   npm run loadtest -- --base-url http://127.0.0.1:3100 --vus 20 --duration 60 --ws
 *
 * 参数(全部可选):
 *   --base-url          目标服务(默认 http://127.0.0.1:3100;绝不要指向 :3000 演示环境)
 *   --vus               并发学生数(默认 20)
 *   --duration          压测时长秒(默认 60)
 *   --think-ms          每步思考时间均值 ms,±50% 抖动(默认 200;0=全速压)
 *   --teacher-interval-ms  教师端轮询间隔(默认 2000)
 *   --relogin-every     学生每 N 轮重新登录(默认 10;0=只登录一次)
 *   --ws                启用课堂 WS 场景(20 连接 join 同一 session)
 *   --max-error-rate    错误率阈值,超过退出码 1(默认 0.01)
 *   --max-p95-ms        任一端点 P95 阈值 ms(默认 2000)
 *   --setup-only        只跑准备阶段(建学生/卷/作业),不施压
 *   --admin-phone/--admin-password/--teacher-phone/--teacher-password  账号覆盖
 *
 * 红线:AI 端点(/ai/qa、class:ai_ask)不打——真实 LLM 计费。
 */
import { Recorder, renderTable } from './metrics';
import { setup } from './setup';
import { studentVU, teacherVU, wsPhase, LoadOptions } from './scenario';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<number> {
  const baseUrl = arg('base-url', 'http://127.0.0.1:3100').replace(/\/$/, '');
  const vus = Number(arg('vus', '20'));
  const durationSec = Number(arg('duration', '60'));
  const maxErrorRate = Number(arg('max-error-rate', '0.01'));
  const maxP95 = Number(arg('max-p95-ms', '2000'));
  const opts: LoadOptions = {
    baseUrl,
    durationSec,
    thinkMs: Number(arg('think-ms', '200')),
    teacherIntervalMs: Number(arg('teacher-interval-ms', '2000')),
    reloginEvery: Number(arg('relogin-every', '10')),
  };

  if (/:3000(\/|$)/.test(baseUrl)) {
    console.error('✖ 拒绝执行:base-url 指向 :3000(演示环境红线)。请用隔离实例(如 :3100)。');
    return 2;
  }

  // ---- 连通性 ----
  try {
    const res = await fetch(`${baseUrl}/healthz`);
    if (!res.ok) throw new Error(`healthz HTTP ${res.status}`);
  } catch (e) {
    console.error(`✖ 目标不可达:${baseUrl}/healthz —— ${(e as Error).message}`);
    return 2;
  }

  // ---- 准备阶段 ----
  const setupRec = new Recorder();
  console.log(`▶ 准备阶段:确保 ${vus} 名压测学生 + 压测卷 + consolidation 作业 …`);
  const t0 = performance.now();
  let fx;
  try {
    fx = await setup(
      {
        baseUrl,
        vus,
        ws: flag('ws'),
        adminPhone: arg('admin-phone', '13800000001'),
        adminPassword: arg('admin-password', 'Admin@123'),
        teacherPhone: arg('teacher-phone', '13800000002'),
        teacherPassword: arg('teacher-password', 'Teacher@123'),
      },
      setupRec,
    );
  } catch (e) {
    console.error(`✖ 准备阶段失败:${(e as Error).message}`);
    return 2;
  }
  console.log(
    `✓ 准备完成(${((performance.now() - t0) / 1000).toFixed(1)}s):courseId=${fx.courseId} ` +
      `assignmentId=${fx.assignmentId} students=${fx.students.length}` +
      (flag('ws') ? ` sessionId=${fx.sessionId ?? '无(WS 跳过)'}` : ''),
  );
  if (flag('setup-only')) return 0;

  // ---- 压测阶段 ----
  console.log(`▶ 压测:${vus} 学生 VU × ${durationSec}s + 1 教师 VU${flag('ws') && fx.sessionId != null ? ' + WS 在堂' : ''}(think=${opts.thinkMs}ms)`);
  const rec = new Recorder();
  const startedAt = performance.now();
  const deadline = Date.now() + durationSec * 1000;

  const tasks: Promise<void>[] = [
    ...fx.students.slice(0, vus).map((cred) => studentVU(cred, fx, opts, rec, deadline)),
    teacherVU(fx, opts, rec, deadline),
  ];
  if (flag('ws')) tasks.push(wsPhase(fx, opts, rec, deadline));
  await Promise.all(tasks);
  const elapsedSec = (performance.now() - startedAt) / 1000;

  // ---- 报表 ----
  const rows = rec.snapshot();
  const totals = rec.totals(elapsedSec);
  console.log(`\n===== D4 压测结果(${baseUrl},${vus} VU × ${durationSec}s,单位 ms)=====\n`);
  console.log(renderTable(rows));
  console.log(
    `\n总计:requests=${totals.requests} errors=${totals.errors} ` +
      `错误率=${(totals.errorRate * 100).toFixed(2)}% RPS=${totals.rps.toFixed(1)} 实际时长=${elapsedSec.toFixed(1)}s`,
  );

  // ---- 阈值门禁 ----
  const failures: string[] = [];
  if (totals.errorRate > maxErrorRate) {
    failures.push(`总错误率 ${(totals.errorRate * 100).toFixed(2)}% > ${(maxErrorRate * 100).toFixed(2)}%`);
  }
  for (const r of rows) {
    if (r.p95 > maxP95) failures.push(`${r.label} P95=${r.p95.toFixed(0)}ms > ${maxP95}ms`);
  }
  if (failures.length) {
    console.error(`\n✖ 未达标:\n  - ${failures.join('\n  - ')}`);
    return 1;
  }
  console.log(`\n✓ 达标:错误率 ≤ ${(maxErrorRate * 100).toFixed(2)}%,全端点 P95 ≤ ${maxP95}ms`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error('✖ 压测异常终止:', e);
    process.exit(2);
  },
);
