import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { AiFeature } from '@qiming/contracts';
import { REDIS } from '../../redis/redis.module';
import { loadAiConfigJson } from '../config-loader';
import type { Pricing, RouteEntry, RouteTable } from './types';

/** 路由表热更新 Redis 键(a7: 前缀纪律;值为 RouteTable 的部分覆盖 JSON) */
export const ROUTES_OVERRIDE_KEY = 'a7:ai:routes';

/** 真实供应商标识(与 ai-admin.service 口径一致:env 有 key 时四功能默认走它) */
const REAL_PROVIDER = 'openai_compatible';
const REAL_DEFAULT_FEATURES: AiFeature[] = ['qa', 'pre_grading', 'class_companion', 'diagnosis'];

/**
 * 路由表(任务卡 A7 选型:config 文件保存默认值 + Redis 覆盖实现热更新):
 * - 默认值:src/ai/config/ai-routes.default.json(feature → provider/model/fallback + 单价表);
 * - 热更新:向 Redis SET a7:ai:routes 写同形状的**部分**JSON(routes/pricing 均可只给改动项),
 *   每次 resolve 时读取合并 —— 切路由不重启即生效(验收项),DEL 该键即回滚默认;
 * - 单价表 pricing 以 model 为键,缺省落 default —— 计费 = tokens/1000 × 单价,可手算。
 */
@Injectable()
export class RouteTableService {
  /** mock 基线默认表(ai-routes.default.json,四功能 provider 恒为 mock) */
  private readonly mockDefaults: RouteTable;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly cfg: ConfigService,
  ) {
    this.mockDefaults = loadAiConfigJson<RouteTable>('ai-routes.default.json');
  }

  /**
   * 生效默认表:**永久修复**——env 配了真实 LLM key(LLM_API_KEY)时,四功能默认即走真实供应商
   * (openai_compatible,model=env,fallback 回各自 mock);未配 key 才回 mock 基线。
   * 这样真实 AI 不再依赖 Redis 那份易失的运行态覆盖(Redis flush/重启后也不会静默退回 mock)。
   * 懒读 cfg(每次 resolve 时判定),与 OpenAiCompatibleProvider.envKey() 同口径 —— e2e 隔离
   * (E2E_LLM_ISOLATION=1 在每用例前置 LLM_API_KEY='')照旧落 mock,不破坏 a6/a7 既有断言。
   * Redis a7:ai:routes 覆盖仍优先(admin「真实↔mock」开关可逐功能强制覆盖此默认)。
   */
  private effectiveDefaults(): RouteTable {
    const hasRealKey = !!(this.cfg.get<string>('LLM_API_KEY', '') ?? '').trim();
    if (!hasRealKey) return this.mockDefaults;
    const routes = { ...this.mockDefaults.routes };
    for (const f of REAL_DEFAULT_FEATURES) {
      const def = this.mockDefaults.routes[f];
      const mockModel = def?.provider === 'mock' ? def.model : (def?.fallback?.model ?? 'mock-chat-mini');
      routes[f] = { provider: REAL_PROVIDER, model: 'env', fallback: { provider: 'mock', model: mockModel } };
    }
    return { routes, pricing: this.mockDefaults.pricing };
  }

  /** 当前生效全表(env 感知默认 + Redis 覆盖逐 feature/model 合并) */
  async table(): Promise<RouteTable> {
    const base = this.effectiveDefaults();
    const raw = await this.redis.get(ROUTES_OVERRIDE_KEY).catch(() => null);
    if (!raw) return base;
    let override: Partial<RouteTable>;
    try {
      override = JSON.parse(raw) as Partial<RouteTable>;
    } catch {
      return base; // 非法覆盖内容 → 安全回落默认
    }
    return {
      routes: { ...base.routes, ...(override.routes ?? {}) },
      pricing: { ...base.pricing, ...(override.pricing ?? {}) },
    };
  }

  async resolve(feature: AiFeature): Promise<RouteEntry> {
    const t = await this.table();
    const entry = t.routes[feature];
    if (!entry) throw new Error(`路由表缺少 feature=${feature} 的条目`);
    return entry;
  }

  async pricingOf(model: string): Promise<Pricing> {
    const t = await this.table();
    return t.pricing[model] ?? t.pricing.default ?? { inPer1k: 0, outPer1k: 0 };
  }
}
