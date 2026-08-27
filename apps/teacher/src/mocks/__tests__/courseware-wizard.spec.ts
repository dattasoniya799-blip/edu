/**
 * AI 生成课件 mock 端到端(mock 报文 = 契约报文的行为验证):
 *   ① POST /courseware/outline 按 pageCount 出像样大纲(主题串进标题,首页引入、末页小结)
 *   ② POST /courseware/jobs 建 job → 首次查询 queued
 *   ③ GET /courseware/jobs/{jobId} 时间驱动推进;第 3 页固定失败一次 → status=failed 且停止轮询
 *   ④ POST /courseware/jobs/{jobId}/retry → 该页转成功 → status=done + resourceId
 *   ⑤ 成品追加进资源库(type=ppt,meta.kind=ai_courseware,meta.pages),「去资源库查看」能看到
 * 端点已进契约(2026-08-22),这里一律走 createClient 的类型化路径 —— 编译期即校验 mock 与契约同形。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { createClient } from '@qiming/contracts';
import type { CoursewareOutlinePageDto, CoursewareStyleInput, ResourceDto } from '@qiming/contracts';
import { handlers } from '../handlers';
import { COURSEWARE_FAIL_SEQ, coursewareJobs, SLIDE_HEIGHT, SLIDE_WIDTH } from '../data';
import { deriveProgress, isJobExpired } from '../../pages/courseware/lib/progress';
import { CUSTOM_STYLE_ID, DEFAULT_STYLE_ID, getStyle } from '../../pages/courseware/lib/styles';

const server = setupServer(...handlers);
let token: string | null = null;
const api = createClient({
  baseUrl: 'http://localhost/api/v1',
  getToken: () => token,
  fetchImpl: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(async () => {
  const login = await api.post('/auth/login', { body: { phone: '13800000002', password: 'Teacher@123' } });
  token = login.data.accessToken;
});

const SOURCE = '勾股定理:由校园旗杆影长问题引入,回顾直角三角形三边关系,推导 a²+b²=c²,配两道例题。';

async function outline(
  pageCount: number, style: CoursewareStyleInput = { id: DEFAULT_STYLE_ID },
): Promise<CoursewareOutlinePageDto[]> {
  const r = await api.post('/courseware/outline', { body: { sourceText: SOURCE, pageCount, style } });
  return r.data.pages;
}

async function createJob(
  name: string, pages: CoursewareOutlinePageDto[],
  ctx: { lessonId?: number; kpNodeId?: number } = {},
  style: CoursewareStyleInput = { id: DEFAULT_STYLE_ID },
): Promise<string> {
  const r = await api.post('/courseware/jobs', { body: { name, pages, style, ...ctx } });
  return r.data.jobId;
}

const fetchJob = async (jobId: string) =>
  (await api.get('/courseware/jobs/{jobId}', { params: { jobId } })).data;

/** 模拟时间流逝:把所有排期中的页拨到已到点(mock 是时间驱动的,不需要真等) */
function fastForward(jobId: string): void {
  const job = coursewareJobs.get(jobId);
  if (!job) throw new Error(`job ${jobId} 不存在`);
  for (const p of job.pages) p.dueAt = Date.now() - 1;
}

const decodeSvg = (dataUri: string) => decodeURIComponent(dataUri.replace('data:image/svg+xml,', ''));

/**
 * 同一元素上重复声明属性(曾把 stroke-width 写两次)会让 SVG 变成非法 XML,
 * 浏览器直接拒绝渲染整张图 —— 这里做结构守卫。
 */
function expectWellFormedSvg(svg: string): void {
  for (const tag of svg.match(/<[a-z]+[^>]*>/g) ?? []) {
    const names = [...tag.matchAll(/([a-z][a-z-]*)=/g)].map((m) => m[1]);
    expect(new Set(names).size, `重复属性:${tag}`).toBe(names.length);
  }
}

describe('POST /courseware/outline', () => {
  it('按 pageCount 出大纲:主题串进标题,首页引入、末页小结,三字段齐全', async () => {
    const pages = await outline(6);
    expect(pages).toHaveLength(6);
    expect(pages[0].title).toContain('勾股定理');
    expect(pages[0].title).toContain('课题引入');
    expect(pages[5].title).toContain('课堂小结');
    expect(pages.every((p) => p.title.trim() && p.body.trim() && p.imagePrompt.trim())).toBe(true);
  });

  it('每页 3~5 条完整句要点(整句才不会出现「一页几个字」)', async () => {
    const pages = await outline(6);
    for (const p of pages) {
      const bullets = p.body.split('\n').map((l) => l.replace(/^·\s*/, ''));
      expect(bullets.length).toBeGreaterThanOrEqual(3);
      expect(bullets.length).toBeLessThanOrEqual(5);
      for (const b of bullets) {
        expect(b.length).toBeGreaterThanOrEqual(14);
        expect(b).toMatch(/[。??]$/);
      }
    }
  });

  it('imagePrompt 是该页的具体画面描述,并带上所选风格名(完整风格前缀在入队时组装)', async () => {
    const pages = await outline(6, { id: 'dark_tech' });
    expect(pages.every((p) => p.imagePrompt.startsWith('【风格:深色极简科技】'))).toBe(true);
    expect(pages[0].imagePrompt).toContain('示意图');
    // 短描述才好让教师逐页改写,不把整段风格模板塞进输入框
    expect(pages[0].imagePrompt.length).toBeLessThan(120);
  });

  it('自定义风格:画面描述带上教师写的风格主题', async () => {
    const pages = await outline(3, { id: CUSTOM_STYLE_ID, customText: '温暖的水彩画风,柔和的粉蓝色调' });
    expect(pages[0].imagePrompt).toContain('自定义风格 · 温暖的水彩画风,柔和的粉…');
  });

  it('页数边界:3 页与 20 页都成立', async () => {
    expect(await outline(3)).toHaveLength(3);
    expect(await outline(20)).toHaveLength(20);
  });
});

describe('生成任务:时间驱动进度 → 第 3 页失败 → 重试 → 完成落资源库', () => {
  it('全链路', async () => {
    const pages = await outline(5);
    const jobId = await createJob('第5讲 · 勾股定理(AI 生成)', pages, { lessonId: 4, kpNodeId: 102 });
    expect(jobId).toMatch(/^cw-job-/);

    // 刚建好:排队中,一页未出
    const queued = await fetchJob(jobId);
    expect(queued.jobId).toBe(jobId);   // 契约 required:轮询响应回带 jobId
    expect(queued.status).toBe('queued');
    expect(queued.total).toBe(5);
    expect(queued.done).toBe(0);
    expect(deriveProgress(queued).shouldPoll).toBe(true);

    // 时间推进到全部页结算:第 3 页固定失败 → job 级 failed,前端停止轮询并显示重试
    fastForward(jobId);
    const failed = await fetchJob(jobId);
    expect(failed.status).toBe('failed');
    expect(failed.done).toBe(4);
    const p = deriveProgress(failed);
    expect(p.failedSeqs).toEqual([COURSEWARE_FAIL_SEQ]);
    expect(p.canRetry).toBe(true);
    expect(p.shouldPoll).toBe(false);
    expect(failed.resourceId).toBeUndefined();
    // 已完成页带图片(内联 SVG data-URI,缩略图/预览可直接用)
    expect(failed.pages[0].imageUrl?.startsWith('data:image/svg+xml,')).toBe(true);
    expect(failed.pages[COURSEWARE_FAIL_SEQ - 1].imageUrl).toBeUndefined();

    // 重试失败页 → 契约响应是 OkVoid(data=null),进度由下一次轮询读取:回到 running
    const retried = await api.post('/courseware/jobs/{jobId}/retry', { params: { jobId } });
    expect(retried.data).toBeNull();
    const running = await fetchJob(jobId);
    expect(running.status).toBe('running');
    expect(deriveProgress(running).shouldPoll).toBe(true);

    // 再推进:失败页转成功,全部完成 + 落库
    fastForward(jobId);
    const done = await fetchJob(jobId);
    expect(done.status).toBe('done');
    expect(done.done).toBe(5);
    expect(done.pages.every((x) => x.status === 'done' && !!x.imageUrl)).toBe(true);

    // 出图是横版幻灯片:尺寸对齐真实 API 实际返回的 1264×848,且带标题/要点/页码 n/N
    const svg = decodeSvg(done.pages[0].imageUrl!);
    expectWellFormedSvg(svg);
    expect(svg).toContain(`width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}"`);
    expect(SLIDE_WIDTH).toBeGreaterThan(SLIDE_HEIGHT);
    expect(svg).toContain('>1/5<');
    expect(svg).toContain(pages[0].title);
    // 每条要点整句都画上去了(不是只画标题;折行只是分行,不丢字)
    const plain = svg.replace(/<[^>]*>/g, '');
    const bullets = pages[0].body.split('\n').map((l) => l.replace(/^·\s*/, ''));
    expect(bullets.length).toBeGreaterThanOrEqual(3);
    for (const b of bullets) expect(plain).toContain(b);
    expect(decodeSvg(done.pages[4].imageUrl!)).toContain('>5/5<');
    expect(deriveProgress(done)).toMatchObject({ percent: 100, finished: true, shouldPoll: false, canRetry: false });
    expect(typeof done.resourceId).toBe('number');

    // 成品进资源库:type=ppt,meta 形状同真实后端(kind + 逐页对象数组),知识点回填
    const list = (await api.get('/resources', { query: { page: 1, size: 50, type: 'ppt' } })).data as { items: ResourceDto[] };
    const created = list.items.find((r) => r.id === done.resourceId);
    expect(created).toBeTruthy();
    expect(created!.name).toBe('第5讲 · 勾股定理(AI 生成)');
    expect(created!.meta).toMatchObject({ kind: 'ai_courseware', styleId: DEFAULT_STYLE_ID, styleName: '清爽学院蓝' });
    // meta.pages 是逐页对象数组(courseware-page.service.createResource 口径),不是页数数字
    const metaPages = (created!.meta as { pages: { seq: number; title: string; imageOssKey: string | null }[] }).pages;
    expect(metaPages).toHaveLength(5);
    expect(metaPages[0]).toMatchObject({ seq: 1, title: pages[0].title });
    expect(metaPages.every((p) => p.imageOssKey)).toBe(true);
    // 封面 ossKey = 首页整页图(真实是 page-1.png;mock 无对象存储,直接是首页图 data URI)
    expect(created!.ossKey).toBe(done.pages[0].imageUrl);
    expect(created!.kpNodeId).toBe(102);
    expect(created!.kpNodeName).toBe('一次函数的图象');
    expect(created!.usedByLessons).toEqual([]);
  });

  it('重复查询不重复落库(幂等):完成后再查 resourceId 不变', async () => {
    const jobId = await createJob('幂等校验课件', await outline(3));
    fastForward(jobId);
    fastForward(jobId); // 第 3 页失败 → 重试前先确认失败态
    const failed = await fetchJob(jobId);
    expect(failed.status).toBe('failed');
    await api.post('/courseware/jobs/{jobId}/retry', { params: { jobId } });
    fastForward(jobId);
    const first = await fetchJob(jobId);
    const second = await fetchJob(jobId);
    expect(first.status).toBe('done');
    expect(second.resourceId).toBe(first.resourceId);
  });

  it('校验与不存在的 job:空名称 400、空大纲 400、自定义风格缺描述 400、错 jobId 404', async () => {
    const page = { title: 'a', body: 'b', imagePrompt: 'c' };
    const style = { id: DEFAULT_STYLE_ID };
    await expect(api.post('/courseware/jobs', { body: { name: ' ', pages: [page], style } }))
      .rejects.toMatchObject({ code: 4000 });
    await expect(api.post('/courseware/jobs', { body: { name: 'x', pages: [], style } }))
      .rejects.toMatchObject({ code: 4000 });
    await expect(api.post('/courseware/jobs', { body: { name: 'x', pages: [page], style: { id: CUSTOM_STYLE_ID } } }))
      .rejects.toMatchObject({ code: 4000 });
    // 页数上限 20(契约 maxItems)
    await expect(api.post('/courseware/jobs', { body: { name: 'x', pages: Array.from({ length: 21 }, () => page), style } }))
      .rejects.toMatchObject({ code: 4000 });
  });

  it('jobId 不存在 / 已过期 → 404 4040,前端据此提示「任务已过期」', async () => {
    // 带 ?job= 回到向导时的关键分支:mock 内存任务刷新即失效,真实后端是 Redis 24h 过期
    const gone = await api.get('/courseware/jobs/{jobId}', { params: { jobId: 'cw-job-not-exist' } })
      .catch((e: unknown) => e);
    expect(gone).toMatchObject({ code: 4040, httpStatus: 404 });
    expect(isJobExpired(gone)).toBe(true);
    await expect(api.post('/courseware/jobs/{jobId}/retry', { params: { jobId: 'cw-job-not-exist' } }))
      .rejects.toMatchObject({ code: 4040 });
  });
});

describe('风格贯穿:入队提示词与 mock 出图都随风格变', () => {
  it('每页最终提示词 = 所选风格模板 + 整页内容 + 页码(真实后端同口径)', async () => {
    const pages = await outline(3, { id: 'swiss_grid' });
    const jobId = await createJob('瑞士网格课件', pages, {}, { id: 'swiss_grid' });
    const job = coursewareJobs.get(jobId)!;
    expect(job.style.id).toBe('swiss_grid');
    for (const [i, p] of job.pages.entries()) {
      expect(p.finalPrompt.startsWith(getStyle('swiss_grid').promptTemplate)).toBe(true);
      expect(p.finalPrompt).toContain(`页标题:${pages[i].title}`);
      expect(p.finalPrompt).toContain(`页码:右下角标注「${i + 1}/3」`);
    }
  });

  it('自定义风格:每页提示词带护栏 + 教师原文,出图页脚标出自定义主题', async () => {
    const style: CoursewareStyleInput = { id: CUSTOM_STYLE_ID, customText: '温暖的水彩画风,柔和的粉蓝色调' };
    const jobId = await createJob('自定义风格课件', await outline(3, style), {}, style);
    const job = coursewareJobs.get(jobId)!;
    expect(job.pages[0].finalPrompt).toContain('温暖的水彩画风,柔和的粉蓝色调');
    expect(job.pages[0].finalPrompt).toContain('不出现水印');
    fastForward(jobId);
    const svg = decodeSvg((await fetchJob(jobId)).pages[0].imageUrl!);
    expect(svg).toContain('自定义:温暖的水彩画风,柔和的粉…');
  });

  it('不同风格出的图配色不同,深色风格是真的深底浅字', async () => {
    const pages = await outline(3);
    const byStyle = new Map<string, string>();
    for (const id of ['academic_blue', 'dark_tech', 'vector_illust']) {
      const jobId = await createJob(`${id} 课件`, pages, {}, { id });
      fastForward(jobId);
      const svg = decodeSvg((await fetchJob(jobId)).pages[0].imageUrl!);
      expectWellFormedSvg(svg);
      // 底色取自该风格 palette
      expect(svg, id).toContain(`fill="${getStyle(id).palette.bg}"`);
      byStyle.set(id, svg);
    }
    expect(new Set(byStyle.values()).size).toBe(3);
    // 深色风格:深底 + 白色正文
    expect(byStyle.get('dark_tech')).toContain('fill="#0A0A0F"');
    expect(byStyle.get('dark_tech')).toContain('fill="#FFFFFF"');
  });
});
