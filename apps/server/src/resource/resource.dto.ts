import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { ResourceType } from '@qiming/contracts';

export const RESOURCE_TYPES = [
  'ppt',
  'pdf',
  'video',
  'interactive',
  'image',
] as const satisfies readonly ResourceType[];

/** POST /resources(登记已直传 OSS 的资源) */
export class ResourceCreateDto {
  @IsIn(RESOURCE_TYPES) type: ResourceType;
  @IsString() @IsNotEmpty() @MaxLength(128) name: string;
  @IsString() @IsNotEmpty() ossKey: string;
  @Type(() => Number) @IsInt() @Min(0) size: number;
  @IsOptional() @IsObject() meta?: Record<string, unknown>;
  /** C3-back #A:按知识点归档(可空) */
  @IsOptional() @Type(() => Number) @IsInt() kpNodeId?: number;
}

/** PUT /resources/:id(重命名/更新元信息) */
export class ResourceUpdateDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(128) name?: string;
  @IsOptional() @IsObject() meta?: Record<string, unknown>;
  /** C3-back #A:缺省不改、显式 null 清空知识点归档 */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  kpNodeId?: number | null;
}

export class ResourceListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size?: number;
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @IsIn(RESOURCE_TYPES) type?: ResourceType;
  /** C3-back #A:按知识点过滤 */
  @IsOptional() @Type(() => Number) @IsInt() kpNodeId?: number;
}
