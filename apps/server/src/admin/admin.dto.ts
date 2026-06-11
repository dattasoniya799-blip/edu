/** A2 · /admin/* 请求 DTO(校验规则严格对齐 openapi.yaml,类型对齐 @qiming/contracts) */
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ClassType, UserStatus } from '@qiming/contracts';

const USER_STATUS: UserStatus[] = ['active', 'disabled', 'pending'];
const CLASS_TYPES: ClassType[] = ['group', 'one_on_one', 'one_on_three'];

// ---------------- 通用分页 ----------------
export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  size = 20;

  @IsOptional() @IsString()
  keyword?: string;
}

// ---------------- 教师 ----------------
export class TeacherListQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(USER_STATUS)
  status?: UserStatus;
}

export class TeacherInputDto {
  @IsString() @IsNotEmpty() @MaxLength(32)
  name!: string;

  @IsString() @IsNotEmpty()
  phone!: string;

  /** 不传则自动生成 */
  @IsOptional() @IsString() @MaxLength(20)
  teacherNo?: string;

  @IsString() @IsNotEmpty()
  stage!: string;

  @IsString() @IsNotEmpty()
  subject!: string;
}

// ---------------- 学生 ----------------
export class StudentListQueryDto extends PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt()
  courseId?: number;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  deviceBound?: boolean;
}

export class StudentInputDto {
  @IsString() @IsNotEmpty() @MaxLength(32)
  name!: string;

  @IsString() @IsNotEmpty()
  parentPhone!: string;

  @IsOptional() @IsString() @MaxLength(20)
  studentNo?: string;

  @IsString() @IsNotEmpty()
  grade!: string;

  @IsOptional() @IsArray() @IsInt({ each: true })
  courseIds?: number[];
}

// ---------------- 课程 ----------------
export class CourseListQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(CLASS_TYPES)
  classType?: ClassType;
}

export class CourseInputDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  name!: string;

  @IsIn(CLASS_TYPES)
  classType!: ClassType;

  @IsString() @IsNotEmpty()
  subject!: string;

  @IsString() @IsNotEmpty()
  stage!: string;

  @IsInt()
  teacherId!: number;

  @IsInt() @Min(1)
  totalLessons!: number;

  @IsOptional() @IsArray() @IsInt({ each: true })
  studentIds?: number[];
}

// ---------------- AI 用量 / 额度 ----------------
export class DailyQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31)
  days = 14;
}

export class AiQuotaInputDto {
  @IsNumber() @Min(0)
  monthlyLimit!: number;

  @IsInt() @Min(50) @Max(95)
  alertThreshold!: number;

  @IsIn(['disable_qa', 'pause_all', 'record_only'])
  overPolicy!: string;
}

// ---------------- 设置 ----------------
export class StudentHoursDto {
  @IsString() @Matches(/^\d{2}:\d{2}$/)
  start!: string;

  @IsString() @Matches(/^\d{2}:\d{2}$/)
  end!: string;
}

export class SettingsInputDto {
  @IsOptional() @IsBoolean()
  qaGuideOnly?: boolean;

  @IsOptional() @ValidateNested() @Type(() => StudentHoursDto)
  studentHours?: StudentHoursDto;
}
