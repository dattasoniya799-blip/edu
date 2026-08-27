/**
 * 内测功能(E1)· 纯逻辑:实验室条目映射 / 门禁判定 / 4701 识别
 *
 * 事实来源是 GET /features/my(服务端已按 stage + 白名单 + 角色过滤过),
 * 前端只负责「哪个 key 对应哪个页面」以及「拿不到 key 时怎么拦」——不复刻阶段规则。
 */
import { ApiError, ERROR_CODES } from '@qiming/contracts';
import type { MyFeatureDto } from '@qiming/contracts';

export const FEATURE_AI_COURSEWARE = 'ai_courseware';

/** 实验室分区里可进入的教师向功能:key → 入口路由(没登记的 key 只登记不给入口) */
export const LAB_ROUTES: Record<string, { to: string; icon: string }> = {
  [FEATURE_AI_COURSEWARE]: { to: '/courseware/new', icon: '✦' },
};

export interface LabEntry extends MyFeatureDto {
  to: string;
  icon: string;
}

/** /features/my → 实验室卡片列表(只保留本端登记了入口的条目) */
export function labEntries(features: MyFeatureDto[]): LabEntry[] {
  return features.flatMap((f) => {
    const route = LAB_ROUTES[f.key];
    return route ? [{ ...f, ...route }] : [];
  });
}

export function hasFeature(features: MyFeatureDto[], key: string): boolean {
  return features.some((f) => f.key === key);
}

/**
 * 服务端硬门禁的业务码(403 + 4701)。UI 隐藏不是安全边界:
 * 白名单在别处被摘掉时,页面里正在跑的请求会先于下一次 /features/my 拿到这个错。
 */
export function isFeatureNotEnabled(e: unknown): boolean {
  return e instanceof ApiError && e.code === ERROR_CODES.FEATURE_NOT_ENABLED;
}

/** 守卫三态:目录还没到 / 没这个功能 / 放行 */
export type GateState = 'loading' | 'denied' | 'allowed';

export function gateState(features: MyFeatureDto[] | null, key: string): GateState {
  if (features == null) return 'loading';
  return hasFeature(features, key) ? 'allowed' : 'denied';
}
