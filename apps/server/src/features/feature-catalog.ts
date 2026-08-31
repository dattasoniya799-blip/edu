/**
 * 功能目录(E1 内测区与功能分级,经用户批准 2026-08-27)—— 代码内静态注册表,服务端唯一事实。
 *
 * 阶段语义:off=全员不可见(仅管理端登记);beta=白名单账号可见可用;ga=按角色全量可见。
 * 库里(feature_flags)只存机构对 defaultStage 的覆盖值,无行 = 用目录 defaultStage;
 * 白名单(feature_access)仅 beta 阶段生效,replace 语义整表覆写。
 * 后续新功能一律先进本目录(beta 或 off),转正 = 阶段切 ga(涉及导航位调整时另行小改)。
 */
import type { FeatureStage, Role } from '@qiming/contracts';

export interface FeatureCatalogItem {
  key: string;
  name: string;
  description: string;
  /** 面向角色:ga 阶段按此角色全量下发 */
  audienceRole: Role;
  defaultStage: FeatureStage;
  /** 登记说明(known issues):为什么还不能转正 */
  knownIssues: string[];
  /** 转正(切 ga)验收条件 */
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
    defaultStage: 'off',
    knownIssues: [
      '2026-08-31 整体下线(经用户决策:假功能全部下线,真实生图一并下线),需求留档见 docs/需求文档/',
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

/** 按 key 取目录项;未知 key 返回 undefined(调用方决定 404 / 拒绝) */
export function featureByKey(key: string): FeatureCatalogItem | undefined {
  return FEATURE_CATALOG.find((item) => item.key === key);
}
