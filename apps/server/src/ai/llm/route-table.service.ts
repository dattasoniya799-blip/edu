import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { AiFeature } from '@qiming/contracts';
import { REDIS } from '../../redis/redis.module';
import { loadAiConfigJson } from '../config-loader';
import type { Pricing, RouteEntry, RouteTable } from './types';

/** 路由表热更新 Redis 键(a7: 前缀纪律;值为 RouteTable 的部分覆盖 JSON) */
export const ROUTES_OVERRIDE_KEY = 'a7:ai:routes';

/**
 * 路由表(任务卡 A7 选型:config 文件保存默认值 + Redis 覆盖实现热更新):
 * - 默认值:src/ai/config/ai-routes.default.json(feature → provider/model/fallback + 单价表);
 * - 热更新:向 Redis SET a7:ai:routes 写同形状的**部分**JSON(routes/pricing 均可只给改动项),
 *   每次 resolve 时读取合并 —— 切路由不重启即生效(验收项),DEL 该键即回滚默认;
 * - 单价表 pricing 以 model 为键,缺省落 default —— 计费 = tokens/1000 × 单价,可手算。
 */
@Injectable()
export class RouteTableService {
  private readonly defaults: RouteTable;

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    this.defaults = loadAiConfigJson<RouteTable>('ai-routes.default.json');
  }

  /** 当前生效全表(默认 + Redis 覆盖逐 feature/model 合并) */
  async table(): Promise<RouteTable> {
    const raw = await this.redis.get(ROUTES_OVERRIDE_KEY).catch(() => null);
    if (!raw) return this.defaults;
    let override: Partial<RouteTable>;
    try {
      override = JSON.parse(raw) as Partial<RouteTable>;
    } catch {
      return this.defaults; // 非法覆盖内容 → 安全回落默认
    }
    return {
      routes: { ...this.defaults.routes, ...(override.routes ?? {}) },
      pricing: { ...this.defaults.pricing, ...(override.pricing ?? {}) },
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
