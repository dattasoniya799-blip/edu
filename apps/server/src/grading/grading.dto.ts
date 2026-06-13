import { IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

/** PUT /grading/answers/:id/review */
export class ReviewDto {
  @IsNumber() finalScore: number;
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

/** GET /grading/assignments/:id/answers?status= */
export class GradingAnswersQueryDto {
  @IsOptional() @IsIn(['pending', 'graded']) status?: 'pending' | 'graded';
}
