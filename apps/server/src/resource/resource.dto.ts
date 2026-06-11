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
}

/** PUT /resources/:id(重命名/更新元信息) */
export class ResourceUpdateDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(128) name?: string;
  @IsOptional() @IsObject() meta?: Record<string, unknown>;
}

export class ResourceListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size?: number;
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @IsIn(RESOURCE_TYPES) type?: ResourceType;
}
