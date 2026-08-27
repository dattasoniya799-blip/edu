/** E1 · /admin/features* 请求 DTO(校验规则严格对齐 openapi.yaml,类型对齐 @qiming/contracts) */
import { IsArray, IsIn, IsInt } from 'class-validator';
import type { FeatureStage } from '@qiming/contracts';

const FEATURE_STAGES: FeatureStage[] = ['off', 'beta', 'ga'];

/** PUT /admin/features/:key */
export class FeatureStageInputDto {
  @IsIn(FEATURE_STAGES)
  stage!: FeatureStage;
}

/** PUT /admin/features/:key/whitelist(replace 语义;空数组 = 清空名单) */
export class FeatureWhitelistInputDto {
  @IsArray() @IsInt({ each: true })
  userIds!: number[];
}
