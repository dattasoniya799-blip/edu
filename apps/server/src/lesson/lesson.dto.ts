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
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
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

/** 时长可为 0 的环节(作业 / 休息):前者时长承载于作业截止,后者可即时切换 */
const ZERO_DURATION_TYPES: readonly SegmentType[] = ['homework', 'break_time'];

/**
 * 环节时长校验:整数;homework/break_time 允许 0,其余环节须 ≥1。
 * (内置 @Min 无法按同一字段的 type 取不同下界,故自定义约束。)
 */
@ValidatorConstraint({ name: 'segmentDuration', async: false })
class SegmentDurationConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'number' || !Number.isInteger(value)) return false;
    return value >= SegmentDurationConstraint.min(args);
  }
  defaultMessage(args: ValidationArguments): string {
    return `durationMin 必须为整数且 ≥ ${SegmentDurationConstraint.min(args)}`;
  }
  private static min(args: ValidationArguments): number {
    const type = (args.object as { type?: SegmentType }).type;
    return type && ZERO_DURATION_TYPES.includes(type) ? 0 : 1;
  }
}

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
  @Type(() => Number) @Validate(SegmentDurationConstraint) durationMin: number;
  /** 各类型形状见《后端设计文档》§5.2 config 约定 */
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @Type(() => Number) @IsInt() resourceId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() paperId?: number | null;
  /** 关联知识点节点(可空,写);kpNodeName 为只读展示字段,写入忽略 */
  @IsOptional() @Type(() => Number) @IsInt() kpNodeId?: number | null;
  /** 知识点单元序号(可空,读写);同 unitSeq + kpNodeId 为同一单元,null=开场白等单元外环节 */
  @IsOptional() @Type(() => Number) @IsInt() unitSeq?: number | null;
}
