/**
 * D4 压测 · 场景(复用 e2e 验证过的真实 API 序列):
 * - 学生 VU:student/login → 拉作业列表 → 开始作答(题面)→ 逐题提交 4 道客观题 → 交卷,循环;
 *   每 reloginEvery 轮重新登录一次(argon2 校验是真实 CPU 负载,须纳入)。
 * - 教师 VU:login → 周期性拉批改看板(pending)/作业总览/作业进度。
 * - 课堂 WS(可选):每个学生一条 socket.io 连接到 /classroom,class:join 同一 session,
 *   握手+join ack 计入指标,连接保持到压测结束(模拟在堂)。
 * - AI 端点(/ai/qa、class:ai_ask)一律不打:真实 DeepSeek 计费。
 */
import { ApiClient } from './api';
import { Recorder } from './metrics';
import { SetupResult, StudentCred } from './setup';

export interface LoadOptions {
  baseUrl: string;
  durationSec: number;
  thinkMs: number;
  teacherIntervalMs: number;
  reloginEvery: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 思考时间:均值 thinkMs,±50% 抖动(0 则不等待) */
const think = (ms: number) => (ms > 0 ? sleep(ms * (0.5 + Math.random())) : Promise.resolve());
const pickChoice = () => (Math.random() < 0.75 ? 'B' : 'ACD'[Math.floor(Math.random() * 3)]);

async function studentLogin(api: ApiClient, cred: StudentCred): Promise<boolean> {
  const r = await api.call<{ accessToken: string }>(
    'POST',
    '/api/v1/auth/student/login',
    { studentNo: cred.studentNo, password: cred.password },
    'POST /auth/student/login',
  );
  if (r.ok) api.token = r.data.accessToken;
  return r.ok;
}

/** 学生完整作答旅程一轮:列表 → 开始 → 题面 → 4×作答 → 交卷 */
async function studentIteration(
  api: ApiClient,
  assignmentId: number,
  thinkMs: number,
): Promise<void> {
  await api.call('GET', '/api/v1/student/assignments?status=all', undefined, 'GET /student/assignments');

  const start = await api.call<{ id: number; questions: { questionId: number }[] }>(
    'POST',
    '/api/v1/student/attempts',
    { assignmentId },
    'POST /student/attempts',
  );
  if (!start.ok) return;
  const attemptId = start.data.id;

  const detail = await api.call<{ questions: { questionId: number }[] }>(
    'GET',
    `/api/v1/student/attempts/${attemptId}`,
    undefined,
    'GET /student/attempts/:id',
  );
  const questions = (detail.ok ? detail.data.questions : start.data.questions) ?? [];

  for (const q of questions) {
    await think(thinkMs);
    await api.call(
      'PUT',
      `/api/v1/student/attempts/${attemptId}/answers/${q.questionId}`,
      { response: { choice: pickChoice() }, timeSpentSec: 30 + Math.floor(Math.random() * 60) },
      'PUT /student/attempts/:id/answers/:qid',
    );
  }

  await api.call(
    'POST',
    `/api/v1/student/attempts/${attemptId}/submit`,
    undefined,
    'POST /student/attempts/:id/submit',
  );
}

export async function studentVU(
  cred: StudentCred,
  fx: SetupResult,
  opts: LoadOptions,
  rec: Recorder,
  deadline: number,
): Promise<void> {
  const api = new ApiClient(opts.baseUrl, rec);
  if (!(await studentLogin(api, cred))) return; // 登录失败已计错,VU 退出避免刷 401 噪音
  let iter = 0;
  while (Date.now() < deadline) {
    if (opts.reloginEvery > 0 && iter > 0 && iter % opts.reloginEvery === 0) {
      await studentLogin(api, cred);
    }
    await studentIteration(api, fx.assignmentId, opts.thinkMs);
    iter += 1;
    await think(opts.thinkMs);
  }
}

/** 教师 VU:批改名单轮询(真实教师上课/批改时的读负载) */
export async function teacherVU(
  fx: SetupResult,
  opts: LoadOptions,
  rec: Recorder,
  deadline: number,
): Promise<void> {
  const api = new ApiClient(opts.baseUrl, rec);
  const login = await api.call<{ accessToken: string }>(
    'POST',
    '/api/v1/auth/login',
    { phone: fx.teacherCred.phone, password: fx.teacherCred.password },
    'POST /auth/login (teacher)',
  );
  if (!login.ok) return;
  api.token = login.data.accessToken;

  while (Date.now() < deadline) {
    await api.call('GET', '/api/v1/grading/pending', undefined, 'GET /grading/pending');
    await api.call('GET', '/api/v1/assignments', undefined, 'GET /assignments (teacher)');
    await api.call(
      'GET',
      `/api/v1/assignments/${fx.assignmentId}/progress`,
      undefined,
      'GET /assignments/:id/progress',
    );
    await sleep(opts.teacherIntervalMs);
  }
}

/**
 * 课堂 WS(加分项):vus 条 socket.io 连接 join 同一 session,握手连通即达标。
 * 连接保持到 deadline 再断开;失败仅计指标不中断压测。
 */
export async function wsPhase(
  fx: SetupResult,
  opts: LoadOptions,
  rec: Recorder,
  deadline: number,
): Promise<void> {
  if (fx.sessionId == null) return;
  let ioFactory: typeof import('socket.io-client').io;
  try {
    ioFactory = (await import('socket.io-client')).io;
  } catch {
    console.warn('⚠ 未安装 socket.io-client(apps/server devDependencies 应自带),跳过 WS 场景');
    return;
  }

  const sockets: import('socket.io-client').Socket[] = [];
  await Promise.all(
    fx.students.map(async (cred) => {
      // 每生独立登录拿 token(WS 握手鉴权用 auth.token)
      const api = new ApiClient(opts.baseUrl, rec);
      if (!(await studentLogin(api, cred))) return;
      const started = performance.now();
      const ok = await new Promise<boolean>((resolve) => {
        const socket = ioFactory(`${opts.baseUrl}/classroom`, {
          auth: { token: api.token },
          transports: ['websocket'],
          reconnection: false,
          timeout: 10_000,
        });
        sockets.push(socket);
        const timer = setTimeout(() => resolve(false), 15_000);
        socket.on('connect', () => {
          socket
            .timeout(10_000)
            .emit('class:join', { sessionId: fx.sessionId }, (err: unknown, snap: unknown) => {
              clearTimeout(timer);
              resolve(!err && !!snap);
            });
        });
        socket.on('connect_error', () => {
          clearTimeout(timer);
          resolve(false);
        });
        socket.on('exception', () => {
          clearTimeout(timer);
          resolve(false);
        });
      });
      rec.record('WS /classroom connect+join', performance.now() - started, ok);
    }),
  );

  // 保持在堂到压测结束
  await sleep(Math.max(0, deadline - Date.now()));
  for (const s of sockets) s.disconnect();
}
