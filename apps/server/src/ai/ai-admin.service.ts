import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type {
  AiFeature,
  AiFeatureMode,
  AiFeatureRoutesDto,
  AiProviderConfigDto,
  AiProviderConfigInput,
  AiTestResultDto,
} from '@qiming/contracts';
import { AuditService } from '../audit/audit.service';
import type { JwtUser } from '../auth/auth.service';
import { REDIS } from '../redis/redis.module';
import { loadAiConfigJson } from './config-loader';
import { LlmGatewayService } from './llm/llm-gateway.service';
import {
  DEFAULT_CONCURRENCY,
  OpenAiCompatibleProvider,
  PROVIDER_CONFIG_KEY,
} from './llm/providers/openai-compatible.provider';
import { ROUTES_OVERRIDE_KEY, RouteTableService } from './llm/route-table.service';
import type { RouteEntry, RouteTable } from './llm/types';

const FEATURES: AiFeature[] = ['qa', 'pre_grading', 'class_companion', 'diagnosis'];
const REAL_PROVIDER = 'openai_compatible';

/** apiKey 脱敏:前缀 + **** + 后 4 位(绝不回明文);过短的整体打码 */
function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}

/**
 * AI 接口管理(admin)运行态服务(全局一把,a7:ai:provider / a7:ai:routes 不带 org 前缀):
 * - provider 配置读写(key 脱敏读、留空保留写)、并发闸刷新;
 * - 逐功能真假路由读写(real=openai_compatible,mock=默认 mock 模型);
 * - 连通性测试(直连 openai_compatible provider,绕开路由/额度)。
 * 写操作记 audit_logs(actor/org 为 admin 本人)。
 */
@Injectable()
export class AiAdminService {
  /** 默认路由表(取各 feature 的标准 mock 模型,不受当前 Redis 覆盖影响) */
  private readonly defaults = loadAiConfigJson<RouteTable>('ai-routes.default.json');

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly cfg: ConfigService,
    private readonly routes: RouteTableService,
    private readonly gateway: LlmGatewayService,
    private readonly provider: OpenAiCompatibleProvider,
    private readonly audit: AuditService,
  ) {}

  // ---------------- provider 配置 ----------------

  async getConfig(): Promise<AiProviderConfigDto> {
    const raw = await this.redis.get(PROVIDER_CONFIG_KEY).catch(() => null);
    if (raw) {
      try {
        const j = JSON.parse(raw) as Partial<AiProviderConfigInput & { apiKey: string }>;
        const concurrency = Number(j.concurrency);
        return {
          baseUrl: j.baseUrl || this.envBaseUrl(),
          model: j.model || this.envModel(),
          apiKeyMasked: maskApiKey(typeof j.apiKey === 'string' ? j.apiKey : ''),
          concurrency: concurrency > 0 ? Math.floor(concurrency) : DEFAULT_CONCURRENCY,
          source: 'runtime',
        };
      } catch {
        // 损坏内容 → 回落 env 口径
      }
    }
    return {
      baseUrl: this.envBaseUrl(),
      model: this.envModel(),
      apiKeyMasked: maskApiKey(this.envKey()),
      concurrency: DEFAULT_CONCURRENCY,
      source: 'env',
    };
  }

  async putConfig(user: JwtUser, dto: AiProviderConfigInput, ip?: string): Promise<null> {
    // apiKey 留空/缺省 → 保留现有(运行态优先,否则 env);绝不写空覆盖
    const provided = typeof dto.apiKey === 'string' ? dto.apiKey.trim() : '';
    const apiKey = provided !== '' ? provided : await this.currentApiKey();
    const concurrency = Number(dto.concurrency) > 0 ? Math.floor(Number(dto.concurrency)) : DEFAULT_CONCURRENCY;
    const config = { baseUrl: dto.baseUrl, model: dto.model, apiKey, concurrency };
    await this.redis.set(PROVIDER_CONFIG_KEY, JSON.stringify(config));
    this.gateway.setConcurrency(concurrency);
    await this.audit.log({
      actorId: user.uid,
      orgId: user.orgId,
      action: 'admin.ai_config.update',
      targetType: 'ai_provider',
      detail: { baseUrl: dto.baseUrl, model: dto.model, concurrency, apiKeyChanged: provided !== '' },
      ip,
    });
    return null;
  }

  /** 现有 key:运行态 a7:ai:provider 优先,否则 env(不读则回空) */
  private async currentApiKey(): Promise<string> {
    const raw = await this.redis.get(PROVIDER_CONFIG_KEY).catch(() => null);
    if (raw) {
      try {
        const k = (JSON.parse(raw) as { apiKey?: unknown }).apiKey;
        if (typeof k === 'string' && k) return k;
      } catch {
        // ignore
      }
    }
    return this.envKey();
  }

  // ---------------- 逐功能真假路由 ----------------

  async getRoutes(): Promise<AiFeatureRoutesDto> {
    const table = await this.routes.table();
    const modeOf = (f: AiFeature): AiFeatureMode =>
      table.routes[f]?.provider === REAL_PROVIDER ? 'real' : 'mock';
    return {
      qa: modeOf('qa'),
      pre_grading: modeOf('pre_grading'),
      class_companion: modeOf('class_companion'),
      diagnosis: modeOf('diagnosis'),
    };
  }

  async putRoutes(user: JwtUser, dto: AiFeatureRoutesDto, ip?: string): Promise<null> {
    const routes: Record<string, RouteEntry> = {};
    for (const f of FEATURES) {
      routes[f] = this.entryFor(f, dto[f]);
    }
    // 保留现有 pricing 覆盖(若有);仅改 routes
    const existing = await this.redis.get(ROUTES_OVERRIDE_KEY).catch(() => null);
    let pricing: RouteTable['pricing'] | undefined;
    if (existing) {
      try {
        pricing = (JSON.parse(existing) as Partial<RouteTable>).pricing;
      } catch {
        // ignore
      }
    }
    const payload = pricing ? { routes, pricing } : { routes };
    await this.redis.set(ROUTES_OVERRIDE_KEY, JSON.stringify(payload));
    await this.audit.log({
      actorId: user.uid,
      orgId: user.orgId,
      action: 'admin.ai_routes.update',
      targetType: 'ai_routes',
      detail: { ...dto },
      ip,
    });
    return null;
  }

  /** real → openai_compatible + model=env + fallback 回该 feature 的 mock;mock → 默认 mock 条目 */
  private entryFor(feature: AiFeature, mode: AiFeatureMode): RouteEntry {
    const mockModel = this.mockModelOf(feature);
    if (mode === 'real') {
      return { provider: REAL_PROVIDER, model: 'env', fallback: { provider: 'mock', model: mockModel } };
    }
    const def = this.defaults.routes[feature];
    return { provider: 'mock', model: mockModel, fallback: def?.fallback ?? null };
  }

  /** 该 feature 的标准 mock 模型(默认表 provider 恒为 mock,故取其 model) */
  private mockModelOf(feature: AiFeature): string {
    const def = this.defaults.routes[feature];
    if (def?.provider === 'mock') return def.model;
    return def?.fallback?.model ?? 'mock-chat-mini';
  }

  // ---------------- 连通性测试 ----------------

  async test(_feature?: string): Promise<AiTestResultDto> {
    // 直接用配置好的 openai_compatible provider 打一发极小 prompt(绕开路由/额度);永不抛 500
    return this.provider.testConnection();
  }

  // ---------------- env 兜底 ----------------

  private envBaseUrl(): string {
    return this.cfg.get<string>('LLM_BASE_URL', 'https://api.openai.com/v1');
  }

  private envModel(): string {
    return this.cfg.get<string>('LLM_MODEL', '');
  }

  private envKey(): string {
    return this.cfg.get<string>('LLM_API_KEY', '');
  }
}
