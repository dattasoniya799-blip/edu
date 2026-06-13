import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, ValidateIf } from 'class-validator';

/** GET /knowledge/content-packs?graphId=(必填) */
export class ContentPacksQueryDto {
  @Type(() => Number)
  @IsInt({ message: 'graphId 必填且必须为整数' })
  graphId: number;
}

/**
 * PUT /knowledge/content-packs/:kpNodeId 入参(openapi KpContentPackInput)。
 * 语义:字段缺省(undefined)= 不改;显式 null = 清空;给值 = 设置并校验同 org 存在。
 * ValidateIf 放行 null(@IsInt 不接受 null);@IsOptional 放行 undefined。
 */
export class ContentPackInputDto {
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  lectureResourceId?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  practicePaperId?: number | null;

  @IsOptional()
  @IsObject()
  summaryConfig?: Record<string, unknown>;
}
