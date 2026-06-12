import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** POST /ai/qa 请求体(openapi:questionId 可为 null,message ≤500) */
export class QaAskDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  questionId?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  attemptId?: number;

  @IsString()
  @MaxLength(500)
  message!: string;
}
