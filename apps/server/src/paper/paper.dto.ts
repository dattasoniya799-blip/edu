import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import type { PaperType } from '@qiming/contracts';

export const PAPER_TYPES = ['homework', 'exam', 'practice'] as const satisfies readonly PaperType[];

/** 单题分值上界 = paper_questions.score Decimal(5,1) 的列上限 */
export const MAX_ITEM_SCORE = 9999.9;
/** 全卷总分上界 = attempts.score Decimal(6,1) 的列上限(防交卷汇总溢出 → 500) */
export const MAX_TOTAL_SCORE = 99999.9;

export class PaperItemInputDto {
  @Type(() => Number) @IsInt() questionId: number;
  @Type(() => Number) @IsNumber() @IsPositive() @Max(MAX_ITEM_SCORE) score: number;
}

/** 总分合理上界校验:各题分值之和不得超过 attempt.score 列上限,否则交卷汇总会数值溢出 500 */
@ValidatorConstraint({ name: 'paperTotalScore', async: false })
class PaperTotalScoreConstraint implements ValidatorConstraintInterface {
  validate(questions: unknown): boolean {
    if (!Array.isArray(questions)) return true; // 其它校验器负责类型
    const total = questions.reduce(
      (s, q) => s + (typeof q?.score === 'number' ? q.score : 0),
      0,
    );
    return total <= MAX_TOTAL_SCORE;
  }
  defaultMessage(): string {
    return `全卷总分不得超过 ${MAX_TOTAL_SCORE}`;
  }
}

/** openapi PaperInput(POST / PUT 共用,题序 = 数组顺序) */
export class PaperInputDto {
  @IsString() @IsNotEmpty() @MaxLength(128) name: string;
  @IsIn(PAPER_TYPES) type: PaperType;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Validate(PaperTotalScoreConstraint)
  @Type(() => PaperItemInputDto)
  questions: PaperItemInputDto[];
}

export class PaperListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size?: number;
  @IsOptional() @IsIn(PAPER_TYPES) type?: PaperType;
}
