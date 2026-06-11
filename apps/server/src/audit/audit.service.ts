import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { maskDeep } from '../common/logging/mask';
import { runAsUser } from '../common/tenant-context';

/**
 * 审计:账号/密码/导出类动作写 audit_logs(设计文档 §5.2)。
 * detail 入库前深度脱敏;写失败只记日志,不影响业务主流程。
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: {
    actorId: number;
    orgId: number;
    action: string;
    targetType?: string;
    targetId?: number;
    detail?: Record<string, unknown>;
    ip?: string;
  }): Promise<void> {
    try {
      // 审计可能产生于登录中途(尚无 ALS user),以 entry 身份写入
      await runAsUser({ uid: entry.actorId, orgId: entry.orgId, role: 'admin' }, () =>
        this.prisma.client.auditLog.create({
          data: {
            orgId: entry.orgId,
            actorId: entry.actorId,
            action: entry.action,
            targetType: entry.targetType ?? null,
            targetId: entry.targetId ?? null,
            detail: maskDeep(entry.detail ?? {}),
            ip: entry.ip ?? null,
          },
        }),
      );
    } catch (e) {
      this.logger.error(`audit 写入失败 action=${entry.action}: ${(e as Error).message}`);
    }
  }
}
