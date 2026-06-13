import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() phone: string;
  @IsString() password: string;
}

export class StudentLoginDto {
  @IsString() studentNo: string;
  @IsString() password: string;
}

export class RefreshDto {
  @IsString() refreshToken: string;
}

export class ChangePasswordDto {
  @IsString() oldPassword: string;
  @IsString() @MinLength(8) newPassword: string;
}
