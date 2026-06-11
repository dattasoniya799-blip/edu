import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

/** PUT /grading/answers/:id/review */
export class ReviewDto {
  @IsNumber() finalScore: number;
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}
