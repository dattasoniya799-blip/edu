import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import type { AssignmentKind } from '@qiming/contracts';

/** GET /assignments 作业总览查询(C3-back #C):courseId/lessonId/status 均选填 */
export class AssignmentListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() courseId?: number;
  @IsOptional() @Type(() => Number) @IsInt() lessonId?: number;
  @IsOptional() @IsIn(['ongoing', 'finished']) status?: 'ongoing' | 'finished';
}

export const ASSIGNMENT_KINDS = [
  'homework',
  'in_class',
  'correction',
  'wrong_redo',
  'consolidation',
] as const satisfies readonly AssignmentKind[];

/** target:courseId 或 studentIds 二选一(service 校验互斥) */
export class AssignmentTargetDto {
  @IsOptional() @Type(() => Number) @IsInt() courseId?: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Type(() => Number)
  studentIds?: number[];
}

/** openapi AssignmentInput */
export class AssignmentInputDto {
  @Type(() => Number) @IsInt() paperId: number;
  @IsOptional() @Type(() => Number) @IsInt() lessonId?: number;
  @IsIn(ASSIGNMENT_KINDS) kind: AssignmentKind;

  @IsDefined()
  @ValidateNested()
  @Type(() => AssignmentTargetDto)
  target: AssignmentTargetDto;

  @IsOptional() @IsDateString() dueAt?: string;
}
