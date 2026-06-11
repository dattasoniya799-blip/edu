import { Body, Controller, Get, HttpCode, Ip, Post, Put } from '@nestjs/common';
import { CurrentUser, Public } from '../common/decorators';
import { AuthService, JwtUser } from './auth.service';
import { ChangePasswordDto, LoginDto, QrExchangeDto, RefreshDto } from './auth.dto';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto.phone, dto.password, ip);
  }

  @Public()
  @Post('auth/student/qr-exchange')
  @HttpCode(200)
  qrExchange(@Body() dto: QrExchangeDto, @Ip() ip: string) {
    return this.auth.qrExchange(dto.token, dto.deviceFingerprint, dto.deviceName, ip);
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: JwtUser) {
    await this.auth.logout(user);
    return null;
  }

  @Get('me')
  me(@CurrentUser() user: JwtUser) {
    return this.auth.me(user);
  }

  @Put('me/password')
  async changePassword(@CurrentUser() user: JwtUser, @Body() dto: ChangePasswordDto, @Ip() ip: string) {
    await this.auth.changePassword(user, dto.oldPassword, dto.newPassword, ip);
    return null;
  }
}
