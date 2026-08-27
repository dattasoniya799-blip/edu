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
import { BizException, ERR_AI_IMAGE_KEY_MISSING } from './ai.codes';
import { loadAiConfigJson } from './config-loader';
import { LlmGatewayService } from './llm/llm-gateway.service';
import { OpenAiCompatibleImageProvider } from './llm/providers/openai-compatible-image.provider';
import {
  DEFAULT_CONCURRENCY,
  OpenAiCompatibleProvider,
  PROVIDER_CONFIG_KEY,
} from './llm/providers/openai-compatible.provider';
import { imageRealEntry, ROUTES_OVERRIDE_KEY, RouteTableService } from './llm/route-table.service';
import type { RouteEntry, RouteTable } from './llm/types';

const FEATURES: AiFeature[] = ['qa', 'pre_grading', 'class_companion', 'diagnosis', 'courseware'];
const REAL_PROVIDER = 'openai_compatible';
/** [2026-08-22 courseware] 生图能力的真实供应商(与文本能力不同 provider、不同 key) */
const IMAGE_REAL_PROVIDER = 'openai_compatible_image';

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
    private readonly imageProvider: OpenAiCompatibleImageProvider,
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
      table.routes[f]?.provider === this.realProviderOf(f) ? 'real' : 'mock';
    return {
      qa: modeOf('qa'),
      pre_grading: modeOf('pre_grading'),
      class_companion: modeOf('class_companion'),
      diagnosis: modeOf('diagnosis'),
      courseware: modeOf('courseware'),
    };
  }

  async putRoutes(user: JwtUser, dto: AiFeatureRoutesDto, ip?: string): Promise<null> {
    // [2026-08-22 audit-fix-server · P1-11] 生图是独立 key:切真实前先确认 IMAGE_API_KEY 有值,
    // 否则教师一发起就逐页失败(P0-1 后不再静默降级 mock),而管理员在这一步毫无提示。
    if (dto.courseware === 'real' && !this.envImageKey()) {
      throw new BizException(
        ERR_AI_IMAGE_KEY_MISSING,
        '未配置生图 API Key(IMAGE_API_KEY),无法把「课件生成」切到真实供应商',
        { feature: 'courseware', envVar: 'IMAGE_API_KEY' },
      );
    }
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

  /**
   * real → 真实供应商 + fallback 回该 feature 的 mock;mock → 默认 mock 条目。
   * courseware 走生图供应商(model 取 IMAGE_MODEL 真实名,见 imageRealEntry);
   * 四个文本能力照旧 openai_compatible + model=env。
   */
  private entryFor(feature: AiFeature, mode: AiFeatureMode): RouteEntry {
    const def = this.defaults.routes[feature];
    const mockProvider = this.mockProviderOf(feature);
    const mockModel = this.mockModelOf(feature);
    if (mode === 'real') {
      return feature === 'courseware'
        ? imageRealEntry(this.cfg)
        : { provider: REAL_PROVIDER, model: 'env', fallback: { provider: 'mock', model: mockModel } };
    }
    return { provider: mockProvider, model: mockModel, fallback: def?.fallback ?? null };
  }

  /** 该 feature 的真实供应商名(生图能力与文本能力不同) */
  private realProviderOf(feature: AiFeature): string {
    return feature === 'courseware' ? IMAGE_REAL_PROVIDER : REAL_PROVIDER;
  }

  /** 该 feature 的 mock 供应商名(生图能力为 mock_image) */
  private mockProviderOf(feature: AiFeature): string {
    return feature === 'courseware' ? 'mock_image' : 'mock';
  }

  /** 该 feature 的标准 mock 模型(默认表 provider 恒为 mock/mock_image,故取其 model) */
  private mockModelOf(feature: AiFeature): string {
    const def = this.defaults.routes[feature];
    if (def?.provider === this.mockProviderOf(feature)) return def.model;
    return def?.fallback?.model ?? (feature === 'courseware' ? 'mock-image-v1' : 'mock-chat-mini');
  }

  // ---------------- 连通性测试 ----------------

  /**
   * [2026-08-22 audit-fix-server · P1-11] 按 feature 分流:入参此前被整个忽略,
   * 恒测文本供应商 —— 管理员切了「课件生成」再点测试,验的其实是 LLM_API_KEY。
   * courseware → 生图 provider 的最小探活(GET /models,不出图);其余四个文本能力照旧。
   * 两条路径都永不抛错,一律返回结构化 {ok,error}(controller 不该因此 500)。
   */
  async test(feature?: string): Promise<AiTestResultDto> {
    if (feature === 'courseware') return this.imageProvider.testConnection();
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

  /** 生图 key(与文本 key 完全独立;只判空,绝不回显) */
  private envImageKey(): string {
    return (this.cfg.get<string>('IMAGE_API_KEY', '') ?? '').trim();
  }
}
