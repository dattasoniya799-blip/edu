import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

/** GET /kp/nodes 查询参数(openapi:graphId 必填,grade/chapter/keyword 选填) */
export class KpNodesQueryDto {
  @Type(() => Number)
  @IsInt({ message: 'graphId 必填且必须为整数' })
  graphId: number;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsString()
  chapter?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
