/** AI 接口管理(admin)请求 DTO —— 校验规则对齐 @qiming/contracts 的 Input 形状 */
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { AiFeatureMode } from '@qiming/contracts';

const MODES: AiFeatureMode[] = ['real', 'mock'];

/** PUT /admin/ai/config —— apiKey 留空/缺省=保留现有,不覆盖 */
export class AiProviderConfigInputDto {
  @IsString() @IsNotEmpty() @MaxLength(256)
  baseUrl!: string;

  @IsString() @IsNotEmpty() @MaxLength(128)
  model!: string;

  @IsOptional() @IsString() @MaxLength(256)
  apiKey?: string;

  @IsInt() @Min(1) @Max(64)
  concurrency!: number;
}

/** PUT /admin/ai/routes —— 逐功能真假路由开关 */
export class AiFeatureRoutesInputDto {
  @IsIn(MODES) qa!: AiFeatureMode;
  @IsIn(MODES) pre_grading!: AiFeatureMode;
  @IsIn(MODES) class_companion!: AiFeatureMode;
  @IsIn(MODES) diagnosis!: AiFeatureMode;
}

/** POST /admin/ai/test —— 可选指定功能(连通性测试,不据此切路由) */
export class AiTestInputDto {
  @IsOptional() @IsString() @MaxLength(32)
  feature?: string;
}
