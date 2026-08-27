/** AI 生成课件请求 DTO —— 校验规则对齐 openapi 的 4 个 /courseware 端点与 dto.ts 的 Courseware* 类型 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { CoursewareOutlinePageDto, CoursewareStyleInput } from '@qiming/contracts';
import { customStyleId, styleIds } from '../ai/features/courseware-style';

/** 契约 pageCount 3-20;缺省 8(与 openapi minimum/maximum 一致) */
export const DEFAULT_PAGE_COUNT = 8;

/**
 * [2026-08-22 audit-fix-server · P2-23] 逐页文本上限收紧。
 * `imagePrompt` 是「画面描述」,4000 字符本身不合理(上游多半直接 400),且和 body 一起
 * 原样进生图提示词、无任何过滤;`body` 是一页幻灯片的要点,2000 字符已远超排版容量。
 * openapi 的 maxLength 本次不动 —— **DTO 比契约严是安全方向**(契约微调另记待办)。
 */
const MAX_IMAGE_PROMPT = 1000;
const MAX_PAGE_BODY = 2000;

/**
 * 整套课件的 PPT 风格:内置风格只传 id;id='custom' 时 customText 必填非空。
 * 自定义 id 取服务端风格配置(courseware-styles.json 的 customStyleId),前端只传 id。
 */
export class CoursewareStyleInputDto implements CoursewareStyleInput {
  // [2026-08-22 audit-fix-server · P2-15] 入参白名单。此前只校验「字符串且 ≤32」,未知 id
  // 会被 composeStylePrefix 静默回退成默认风格 —— 前端版本落后或 id 拼错时,教师以为选了
  // A 风格实际出的是学院蓝,全程没有任何信号。该做的是白名单,而非三层兜底。
  @IsString() @IsNotEmpty() @MaxLength(32)
  @IsIn(styleIds(), { message: '未知的课件风格' })
  id!: string;

  @ValidateIf((o: CoursewareStyleInputDto) => o.id === customStyleId())
  @IsString()
  @IsNotEmpty({ message: '选择自定义风格时,请描述你想要的视觉主题' })
  @Matches(/\S/, { message: '选择自定义风格时,请描述你想要的视觉主题' })
  @MaxLength(1000)
  customText?: string;
}

/** 逐页大纲的一页(建任务时由教师编辑确认后回传,与大纲出参同形) */
export class CoursewareOutlinePageInputDto implements CoursewareOutlinePageDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;

  @IsString() @MaxLength(MAX_PAGE_BODY)
  body!: string;

  @IsString() @MaxLength(MAX_IMAGE_PROMPT)
  imagePrompt!: string;
}

/** POST /courseware/outline */
export class CoursewareOutlineRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(8000)
  sourceText!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(3) @Max(20)
  pageCount?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  lessonId?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  kpNodeId?: number;

  @IsDefined() @IsObject() @ValidateNested() @Type(() => CoursewareStyleInputDto)
  style!: CoursewareStyleInputDto;
}

/** POST /courseware/jobs */
export class CoursewareJobCreateDto {
  // 纯空白也算空(与 teacher 走查基准 `!body.name?.trim()` 同口径)
  @IsString() @IsNotEmpty() @Matches(/\S/, { message: '课件名称不能为空' }) @MaxLength(128)
  name!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  lessonId?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  kpNodeId?: number;

  @IsDefined() @IsObject() @ValidateNested() @Type(() => CoursewareStyleInputDto)
  style!: CoursewareStyleInputDto;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => CoursewareOutlinePageInputDto)
  pages!: CoursewareOutlinePageInputDto[];
}
