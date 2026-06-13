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

/** PUT /lessons/:id(改标题/时间/开场白) */
export class LessonUpdateDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(128) title?: string;
  @IsOptional() @IsDateString() scheduledStart?: string;
  @IsOptional() @IsDateString() scheduledEnd?: string;
  /**
   * 开场白配置(lesson.openingConfig,可空,读写);如 {resourceId, text}。
   * 传 null 显式清空;不传则不变(用 IsDefined 的缺省语义无法区分,故 service 按 key 存在判断)。
   */
  @IsOptional() @IsObject() openingConfig?: Record<string, unknown> | null;
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
  /** 关联知识点节点(可空,写);kpNodeName 为只读展示字段,写入忽略 */
  @IsOptional() @Type(() => Number) @IsInt() kpNodeId?: number | null;
  /** 知识点单元序号(可空,读写);同 unitSeq + kpNodeId 为同一单元,null=开场白等单元外环节 */
  @IsOptional() @Type(() => Number) @IsInt() unitSeq?: number | null;
}
