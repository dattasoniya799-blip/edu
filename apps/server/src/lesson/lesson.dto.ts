import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import type { SegmentType } from '@qiming/contracts';

/** 运行时枚举值(contracts 仅导出类型) */
export const SEGMENT_TYPES = [
  'warmup',
  'lecture',
  'practice',
  'summary',
  'homework',
  'break_time',
] as const satisfies readonly SegmentType[];

/** PUT /lessons/:id(改标题/时间) */
export class LessonUpdateDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(128) title?: string;
  @IsOptional() @IsDateString() scheduledStart?: string;
  @IsOptional() @IsDateString() scheduledEnd?: string;
}

/** PUT /lessons/:id/segments 元素(openapi Segment;id 由服务端重新生成,忽略入参) */
export class SegmentInputDto {
  @IsOptional() @Type(() => Number) @IsInt() id?: number;
  @Type(() => Number) @IsInt() @Min(1) seq: number;
  @IsIn(SEGMENT_TYPES) type: SegmentType;
  @Type(() => Number) @IsInt() @Min(1) durationMin: number;
  /** 各类型形状见《后端设计文档》§5.2 config 约定 */
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @Type(() => Number) @IsInt() resourceId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() paperId?: number | null;
}
