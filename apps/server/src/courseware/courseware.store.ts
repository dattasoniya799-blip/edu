import { Inject, Injectable } from '@nestjs/common';
import type { CoursewareStyleInput } from '@qiming/contracts';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

/**
 * 生图任务运行态存储(契约口径:jobId 是 Redis 运行态字符串,任务状态**不落库**)。
 *
 * 键:`a7:courseware:job:{jobId}`(a7: 前缀纪律,同 AI 域其他运行态键),类型为 **HASH**:
 *   - `meta`         → JSON:orgId / teacherId / name / style / lessonId / kpNodeId / createdAt / total
 *   - `p:{seq}`      → JSON:该页 {seq,title,body,imagePrompt,status,startedAt,imageOssKey,bytes,actualSize,error}
 *   - `resourceId`   → 成品 Resource id(全部页成功后才写)
 * 用 HASH 而非整体 JSON 是为了**逐页字段级原子写**:worker 并发 2,两页同时结算若各自
 * 读-改-写整份 JSON 会互相覆盖(共享 ioredis 连接下 WATCH/MULTI 亦不可靠)。
 * TTL 24h 由创建时的 EXPIRE 统一控制(逐页 HSET 不刷新 TTL,任务生命周期严格 24h)。
 *
 * 另有两个辅助键:
 *   - `a7:courseware:publish:{jobId}`  落库权占位(SET NX);
 *   - `a7:courseware:teacher:{orgId}:{teacherId}` 该教师的在飞任务 id 集合(限流用,SET)。
 */

export const JOB_TTL_SEC = 24 * 3600;
/** 落库成品的一次性占位(防两页几乎同时结算导致重复建 Resource) */
const PUBLISH_LOCK_TTL_SEC = 3600;

export const jobKey = (jobId: string) => `a7:courseware:job:${jobId}`;
export const publishLockKey = (jobId: string) => `a7:courseware:publish:${jobId}`;
/** 教师在飞任务集合(P1-10 并发任务数上限);TTL 与任务同为 24h,SADD 时续期 */
export const teacherJobsKey = (orgId: number, teacherId: number) =>
  `a7:courseware:teacher:${orgId}:${teacherId}`;
/** 大纲限流固定窗口计数(P1-10) */
export const outlineRateKey = (teacherId: number) => `a7:courseware:rl:outline:${teacherId}`;
/** 建任务限流固定窗口计数(P1-10) */
export const jobRateKey = (teacherId: number) => `a7:courseware:rl:jobs:${teacherId}`;
/** 落库补偿节流(P0-2):挡住每轮轮询都打一次 DB */
export const publishRetryKey = (jobId: string) => `a7:courseware:publishretry:${jobId}`;

export type CoursewarePageStatus = 'pending' | 'done' | 'failed';

export interface CoursewareJobPageState {
  seq: number;
  title: string;
  body: string;
  imagePrompt: string;
  status: CoursewarePageStatus;
  /**
   * [2026-08-22 audit-fix-server · P0-3] worker 取件(认领本页)的时刻,ISO 串。
   * 页状态只有 pending/done/failed,没有 running 也没有租约:worker 被 OOM/发布重启/
   * BullMQ 判 stalled 打断后,那一页会永远停在 pending,任务永远 running,连「重试失败页」
   * 按钮都不出现(canRetry 需要 failed 页)—— 这是设计里唯一没有出口的状态。
   * 有了取件时刻,`CoursewareService` 就能把「pending 且久未结算」派生成 failed 放出重试口。
   * 同时它也充当**认领令牌**:worker 结算时要求 startedAt 未被他人改写才写回结果。
   */
  startedAt?: string | null;
  /** 出图成功后的对象键(resource/{orgId}/{yyyyMM}/{hex}.png) */
  imageOssKey?: string | null;
  /** 该页图片字节数(成品 Resource.size 为各页之和) */
  bytes?: number;
  /** 上游实际出图尺寸(中转会归一参数,以响应实际值为准) */
  actualSize?: string | null;
  /** 失败原因(仅本页,不中断其他页) */
  error?: string | null;
}

export interface CoursewareJobState {
  jobId: string;
  orgId: number;
  teacherId: number;
  name: string;
  style: CoursewareStyleInput;
  lessonId: number | null;
  kpNodeId: number | null;
  pages: CoursewareJobPageState[];
  /**
   * [2026-08-22 audit-fix-server · P2-22] 建任务时定下的总页数,**唯一权威**。
   * 出参 total 与完成判定都用它,不用 `pages.length` —— 后者在 Redis 缺页时会缩水,
   * 8 页任务能变成 5 页任务并直接判 done + 落库一份残缺课件。
   */
  total: number;
  resourceId: number | null;
  createdAt: string;
}

interface JobMeta {
  orgId: number;
  teacherId: number;
  name: string;
  style: CoursewareStyleInput;
  lessonId: number | null;
  kpNodeId: number | null;
  createdAt: string;
  total: number;
}

const pageField = (seq: number) => `p:${seq}`;

/**
 * 条件写单页(Lua,单次往返内「读-判-写」原子完成)。
 * KEYS[1]=job hash;ARGV[1]=字段名;ARGV[2]=新页 JSON;
 * ARGV[3]=允许的当前 status 列表(JSON 数组);ARGV[4]=期望的当前 startedAt
 *   ('*' = 不校验;'' = 要求缺省/null;其余 = 要求逐字相等)。
 * 返回 1 = 写入成功,0 = 任务已过期 / 字段缺失 / 当前状态或认领令牌不匹配。
 */
const SET_PAGE_IF_LUA = `
local cur = redis.call('HGET', KEYS[1], ARGV[1])
if not cur then return 0 end
local ok, obj = pcall(cjson.decode, cur)
if not ok then return 0 end
local allowed = cjson.decode(ARGV[3])
local hit = false
for _, s in ipairs(allowed) do
  if obj.status == s then hit = true end
end
if not hit then return 0 end
if ARGV[4] ~= '*' then
  local st = obj.startedAt
  if st == nil or st == cjson.null then st = '' end
  if tostring(st) ~= ARGV[4] then return 0 end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
return 1
`;

/** 条件写的期望前置状态 */
export interface PageWriteGuard {
  /** 当前 status 必须命中其一 */
  status: CoursewarePageStatus[];
  /** 当前 startedAt 必须等于此值(undefined = 不校验;null = 必须缺省) */
  startedAt?: string | null;
}

@Injectable()
export class CoursewareStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** 建任务:一次 HSET 写入 meta + 全部页,再 EXPIRE 24h */
  async create(state: CoursewareJobState): Promise<void> {
    const meta: JobMeta = {
      orgId: state.orgId,
      teacherId: state.teacherId,
      name: state.name,
      style: state.style,
      lessonId: state.lessonId,
      kpNodeId: state.kpNodeId,
      createdAt: state.createdAt,
      total: state.total,
    };
    const fields: Record<string, string> = { meta: JSON.stringify(meta) };
    for (const p of state.pages) fields[pageField(p.seq)] = serializePage(p);
    const key = jobKey(state.jobId);
    await this.redis.hset(key, fields);
    await this.redis.expire(key, JOB_TTL_SEC);
  }

  /** 读任务;不存在/已过期/内容损坏 → null */
  async get(jobId: string): Promise<CoursewareJobState | null> {
    const h = await this.redis.hgetall(jobKey(jobId));
    if (!h || !h.meta) return null;
    let meta: JobMeta;
    try {
      meta = JSON.parse(h.meta) as JobMeta;
    } catch {
      return null;
    }
    const pages: CoursewareJobPageState[] = [];
    for (let seq = 1; seq <= meta.total; seq += 1) {
      const raw = h[pageField(seq)];
      if (!raw) continue; // 缺页:不补齐也不缩水 total,由上层按「未完成」处理(P2-22)
      try {
        pages.push(JSON.parse(raw) as CoursewareJobPageState);
      } catch {
        return null;
      }
    }
    pages.sort((a, b) => a.seq - b.seq);
    return {
      jobId,
      orgId: meta.orgId,
      teacherId: meta.teacherId,
      name: meta.name,
      style: meta.style,
      lessonId: meta.lessonId,
      kpNodeId: meta.kpNodeId,
      pages,
      total: meta.total,
      resourceId: h.resourceId ? Number(h.resourceId) : null,
      createdAt: meta.createdAt,
    };
  }

  /** 任务剩余存活秒数(P2-13:worker 起跑前判剩余 TTL);键不存在 → 0 */
  async ttl(jobId: string): Promise<number> {
    const t = await this.redis.ttl(jobKey(jobId));
    return t > 0 ? t : 0;
  }

  /** 覆写单页(字段级原子写;任务已过期则不复活) */
  async setPage(jobId: string, page: CoursewareJobPageState): Promise<void> {
    const key = jobKey(jobId);
    if (!(await this.redis.exists(key))) return;
    await this.redis.hset(key, pageField(page.seq), serializePage(page));
  }

  /**
   * 条件写单页([2026-08-22 audit-fix-server · P1-4]):仅当该页的当前状态(以及可选的
   * 认领令牌 startedAt)与期望一致时才写入,返回是否写成功。
   *
   * 解决两处竞态:
   * - retry 连点/双标签页:原先是「读快照 → 无条件 setPage(pending) → 入队」,两次请求都
   *   会把同一页置 pending 并各自入队,worker 并发 2 同时取到 → 生两张图、多计一次费用,
   *   后写的 imageOssKey 覆盖前者,前一张 PNG 成为永久孤儿文件。现在只有条件写成功的页入队。
   * - worker 认领与结算:两个 worker 只有一个能把 pending 认领成「带 startedAt 的 pending」;
   *   结算时再要求 startedAt 未变,已被 retry 重置的页不会被上一轮的迟到结果覆盖。
   */
  async setPageIf(jobId: string, page: CoursewareJobPageState, guard: PageWriteGuard): Promise<boolean> {
    const expectStarted = guard.startedAt === undefined ? '*' : (guard.startedAt ?? '');
    const res = await this.redis.eval(
      SET_PAGE_IF_LUA,
      1,
      jobKey(jobId),
      pageField(page.seq),
      serializePage(page),
      JSON.stringify(guard.status),
      expectStarted,
    );
    return Number(res) === 1;
  }

  /** 记成品资源 id */
  async setResourceId(jobId: string, resourceId: number): Promise<void> {
    const key = jobKey(jobId);
    if (!(await this.redis.exists(key))) return;
    await this.redis.hset(key, 'resourceId', String(resourceId));
  }

  /** 抢落库权:仅首个抢到者建 Resource(SET NX) */
  async claimPublish(jobId: string): Promise<boolean> {
    const res = await this.redis.set(publishLockKey(jobId), '1', 'EX', PUBLISH_LOCK_TTL_SEC, 'NX');
    return res === 'OK';
  }

  /**
   * 释放落库权([2026-08-22 audit-fix-server · P0-2])。
   * 建 Resource 抛错(DB 抖动 / name 触碰 VarChar(128) / kpNode 已被删触发 FK 失败)时,
   * 原先只 log 后 rethrow,锁要挂满 1 小时 —— 期间任何补救路径都被挡在门外,教师看到
   * 「已存入资源库」但资源库里什么都没有,点多少次重试都恢复不了。
   */
  async releasePublish(jobId: string): Promise<void> {
    await this.redis.del(publishLockKey(jobId)).catch(() => undefined);
  }

  // ---------------- 教师在飞任务集合(P1-10) ----------------

  /** 登记一个新任务到该教师的在飞集合 */
  async trackJob(orgId: number, teacherId: number, jobId: string): Promise<void> {
    const key = teacherJobsKey(orgId, teacherId);
    await this.redis.sadd(key, jobId);
    await this.redis.expire(key, JOB_TTL_SEC);
  }

  /** 该教师登记过的任务 id(可能含已过期/已终态的,由上层按运行态复核后 untrack) */
  async trackedJobIds(orgId: number, teacherId: number): Promise<string[]> {
    return this.redis.smembers(teacherJobsKey(orgId, teacherId));
  }

  /** 从在飞集合摘除(任务已终态或已过期) */
  async untrackJobs(orgId: number, teacherId: number, jobIds: string[]): Promise<void> {
    if (!jobIds.length) return;
    await this.redis.srem(teacherJobsKey(orgId, teacherId), ...jobIds);
  }
}

/**
 * 页状态序列化:`startedAt` 为空时**不写该字段**(而非写 null)。
 * Lua 侧的认领令牌比对以「字段缺省 = 空串」为准,少一种 cjson.null 形态少一类边界。
 */
function serializePage(page: CoursewareJobPageState): string {
  const { startedAt, ...rest } = page;
  return JSON.stringify(startedAt ? { ...rest, startedAt } : rest);
}
