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
  ValidateNested,
} from 'class-validator';
import type { PaperType } from '@qiming/contracts';

export const PAPER_TYPES = ['homework', 'exam', 'practice'] as const satisfies readonly PaperType[];

export class PaperItemInputDto {
  @Type(() => Number) @IsInt() questionId: number;
  @Type(() => Number) @IsNumber() @IsPositive() score: number;
}

/** openapi PaperInput(POST / PUT 共用,题序 = 数组顺序) */
export class PaperInputDto {
  @IsString() @IsNotEmpty() @MaxLength(128) name: string;
  @IsIn(PAPER_TYPES) type: PaperType;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaperItemInputDto)
  questions: PaperItemInputDto[];
}

export class PaperListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) size?: number;
  @IsOptional() @IsIn(PAPER_TYPES) type?: PaperType;
}
