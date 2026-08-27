/**
 * 内测区与功能分级 mock 存储(E1,2026-08-27;三端同一份)
 *
 * 目录口径 = 服务端 apps/server/src/features/feature-catalog.ts(唯一事实,此处只读镜像);
 * stage / whitelist 是运行态覆盖,管理端 PUT 即时改写(有状态 mock,刷新页面复位)。
 * 走查口径:ai_courseware=beta 且演示教师(张明)在白名单;photo_pregrade=off(谁都拿不到)。
 */
import type {
  AdminFeatureDto, AdminFeatureWhitelistItemDto, FeatureStage, MeDto, MyFeatureDto, Role,
} from '@qiming/contracts';
import * as D from './data';

export interface FeatureCatalogItem {
  key: string;
  name: string;
  description: string;
  audienceRole: Role;
  defaultStage: FeatureStage;
  knownIssues: string[];
  acceptance: string[];
}

export const FEATURE_AI_COURSEWARE = 'ai_courseware';
export const FEATURE_PHOTO_PREGRADE = 'photo_pregrade';

export const FEATURE_CATALOG: FeatureCatalogItem[] = [
  {
    key: FEATURE_AI_COURSEWARE,
    name: 'AI 生成课件',
    description: '文字稿一键生成逐页课件:大纲确认 → 逐页生图 → 成品落资源库,可挂到讲次环节。',
    audienceRole: 'teacher',
    defaultStage: 'beta',
    knownIssues: [
      '真实生图链路未真机验证(当前默认 mock 生图)',
      '课堂整页图未接线(课堂对 ai_courseware 显式跳过)',
    ],
    acceptance: [
      '真实生图链路真机验证通过',
      '课堂整页图接线并完成走查',
    ],
  },
  {
    key: FEATURE_PHOTO_PREGRADE,
    name: '拍照预批',
    description: '作答拍照/公式作答提交后由 AI 预批给出分步意见,最终得分以教师复核为准。',
    audienceRole: 'student',
    defaultStage: 'off',
    knownIssues: [
      'OCR 是 stub(假文本预批)',
      '等真 OCR(Qwen3-VL 路线)后再开内测',
    ],
    acceptance: [
      '接入真实 OCR(Qwen3-VL 路线)',
      '预批结果在真实手写样本抽检达标后开 beta',
    ],
  },
];

/** 运行态 stage 覆盖:无键 = 用目录 defaultStage(对齐 feature_flags 无行的语义) */
export const featureStages: Record<string, FeatureStage> = {};
/** 白名单(replace 语义整表覆写);演示教师预置进 ai_courseware,保证走查可用 */
export const featureWhitelist: Record<string, number[]> = {
  [FEATURE_AI_COURSEWARE]: [D.ME_TEACHER.id],
  [FEATURE_PHOTO_PREGRADE]: [],
};

export const featureByKey = (key: string): FeatureCatalogItem | undefined =>
  FEATURE_CATALOG.find((f) => f.key === key);

export const featureStage = (item: FeatureCatalogItem): FeatureStage =>
  featureStages[item.key] ?? item.defaultStage;

/** 运行时门禁:ga=角色匹配全量;beta=白名单内;off=全员不可 */
export function featureEnabled(me: MeDto, key: string): boolean {
  const item = featureByKey(key);
  if (!item) return false;
  const stage = featureStage(item);
  if (stage === 'ga') return me.role === item.audienceRole;
  if (stage === 'beta') return (featureWhitelist[key] ?? []).includes(me.id);
  return false;
}

/** GET /features/my 下发口径(off 不下发) */
export function myFeatures(me: MeDto): MyFeatureDto[] {
  return FEATURE_CATALOG.flatMap((item) => {
    const stage = featureStage(item);
    if (stage === 'off' || !featureEnabled(me, item.key)) return [];
    return [{ key: item.key, name: item.name, stage, description: item.description }];
  });
}

/** 白名单 userId → 姓名/角色(教师表、学生表按 id 反查;查不到的丢弃) */
function whitelistItems(key: string): AdminFeatureWhitelistItemDto[] {
  return (featureWhitelist[key] ?? []).flatMap<AdminFeatureWhitelistItemDto>((userId) => {
    const teacher = D.teachers.find((t) => t.id === userId);
    if (teacher) return [{ userId, name: teacher.name, role: 'teacher' }];
    const student = D.students.find((s) => s.id === userId);
    if (student) return [{ userId, name: student.name, role: 'student' }];
    return [];
  });
}

/** GET /admin/features:目录全量 + 当前 stage + 白名单 */
export function adminFeatures(): AdminFeatureDto[] {
  return FEATURE_CATALOG.map((item) => ({
    key: item.key,
    name: item.name,
    description: item.description,
    audienceRole: item.audienceRole,
    defaultStage: item.defaultStage,
    stage: featureStage(item),
    whitelist: whitelistItems(item.key),
    knownIssues: item.knownIssues,
    acceptance: item.acceptance,
  }));
}

/** vitest 复位:回到走查种子口径 */
export function resetFeatures(): void {
  for (const k of Object.keys(featureStages)) delete featureStages[k];
  featureWhitelist[FEATURE_AI_COURSEWARE] = [D.ME_TEACHER.id];
  featureWhitelist[FEATURE_PHOTO_PREGRADE] = [];
}
