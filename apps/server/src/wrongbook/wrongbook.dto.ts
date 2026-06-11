import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { WrongStatus } from '@qiming/contracts';

/** GET /student/wrong-book 查询参数 */
export class WrongBookQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) size?: number;
  @IsOptional() @IsIn(['open', 'cleared']) status?: WrongStatus;
}
