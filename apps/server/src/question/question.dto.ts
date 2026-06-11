import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { QuestionAnswer, QuestionStatus, QuestionType } from '@qiming/contracts';

/** 运行时枚举值(镜像 @qiming/contracts 的 type 字面量,contracts 仅导出类型无运行时值) */
const QUESTION_TYPES = ['single', 'multi', 'blank', 'solution'] as const satisfies readonly QuestionType[];
const QUESTION_STATUSES = ['draft', 'published', 'retired'] as const satisfies readonly QuestionStatus[];

export class FigureDto {
  @IsString() @IsNotEmpty() ossKey: string;
  @Type(() => Number) @IsInt() position: number;
}

export class QuestionOptionInputDto {
  @IsString() @IsNotEmpty() @MaxLength(4) label: string;
  @IsString() @IsNotEmpty() contentLatex: string;
  @IsOptional() @IsBoolean() isCorrect?: boolean;
}

export class RubricStepDto {
  @Type(() => Number) @IsInt() step: number;
  @IsString() @IsNotEmpty() desc: string;
  @Type(() => Number) @IsNumber() score: number;
}

/** openapi QuestionInput(create / put 共用,选择题/解答题约束在 service 校验) */
export class QuestionInputDto {
  @IsIn(QUESTION_TYPES) type: QuestionType;
  @IsString() @IsNotEmpty() stage: string;
  @IsString() @IsNotEmpty() subject: string;
  @IsOptional() @IsString() textbookVersion?: string;
  @IsOptional() @IsString() chapter?: string;
  @IsString() @IsNotEmpty() stemLatex: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FigureDto)
  figures?: FigureDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionInputDto)
  options?: QuestionOptionInputDto[];

  /** 形状随题型变化({choice}/{choices}/{texts}/{referenceLatex}),service 内按题型校验 */
  @IsDefined() @IsObject() answer: QuestionAnswer;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RubricStepDto)
  rubric?: RubricStepDto[];

  @IsOptional() @IsString() analysisLatex?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3) difficulty?: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Type(() => Number)
  tagNodeIds?: number[];
}

/** GET /questions 列表过滤 */
export class QuestionListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size?: number;
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @IsIn(QUESTION_TYPES) type?: QuestionType;
  @IsOptional() @IsIn(QUESTION_STATUSES) status?: QuestionStatus;
  @IsOptional() @Type(() => Number) @IsInt() difficulty?: number;
  @IsOptional() @Type(() => Number) @IsInt() tagNodeId?: number;
}
