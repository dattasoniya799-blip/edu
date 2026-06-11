import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** openapi /uploads/sts requestBody */
export const UPLOAD_PURPOSES = ['question_figure', 'resource', 'answer_photo'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export class StsRequestDto {
  @IsIn(UPLOAD_PURPOSES) purpose: UploadPurpose;
  @IsString() @IsNotEmpty() @MaxLength(128) fileName: string;
}
