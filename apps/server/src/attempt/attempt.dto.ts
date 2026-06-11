import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsIn, IsInt, IsObject, IsOptional, Min } from 'class-validator';

/** POST /student/attempts */
export class StartAttemptDto {
  @Type(() => Number) @IsInt() assignmentId: number;
}

/** PUT /student/attempts/:id/answers/:qid(response 形状按题型在 service 校验) */
export class SubmitAnswerDto {
  @IsDefined() @IsObject() response: Record<string, unknown>;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) timeSpentSec?: number;
  @IsOptional() @IsBoolean() flagged?: boolean;
}

/** GET /student/assignments?status= */
export class StudentAssignmentsQueryDto {
  @IsOptional() @IsIn(['pending', 'done', 'all']) status?: 'pending' | 'done' | 'all';
}
