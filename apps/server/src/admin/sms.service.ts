import { Injectable, Logger } from '@nestjs/common';
import { maskSensitive } from '../common/logging/mask';

/**
 * 短信发送(MVP:日志模拟,不接真实服务)。
 * 宪法 §7:手机号脱敏后才进日志;初始密码/登录码本体绝不输出。
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger('SmsMock');

  sendInitialPassword(phone: string): void {
    this.logger.log(`[短信模拟] 已向 ${maskSensitive(phone)} 发送初始密码(内容不落日志)`);
  }

  sendPasswordReset(phone: string): void {
    this.logger.log(`[短信模拟] 已向 ${maskSensitive(phone)} 发送重置后的新密码(内容不落日志)`);
  }

  sendLoginTicket(phone: string): void {
    this.logger.log(`[短信模拟] 已向 ${maskSensitive(phone)} 发送平板登录码(内容不落日志)`);
  }
}
