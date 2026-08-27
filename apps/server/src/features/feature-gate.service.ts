import { HttpStatus, Injectable } from '@nestjs/common';
import type { FeatureStage } from '@qiming/contracts';
import type { JwtUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { BizException, ERR_FEATURE_NOT_ENABLED } from './business.exception';
import { featureByKey } from './feature-catalog';

/**
 * 功能运行时硬门禁(E1):UI 隐藏不是安全边界,受管控端点必须在服务端断言。
 * 判定口径与 /features/my 下发一致:
 * - ga:角色匹配目录 audienceRole → 放行
 * - beta:该用户在本机构该 key 的白名单内 → 放行
 * - off / 未知 key:一律拒绝
 */
@Injectable()
export class FeatureGateService {
  constructor(private readonly prisma: PrismaService) {}

  /** 某 key 在当前机构的生效阶段:flag 覆盖行优先,无行用目录 defaultStage;未知 key → null */
  async stageOf(key: string): Promise<FeatureStage | null> {
    const item = featureByKey(key);
    if (!item) return null;
    const flag = await this.prisma.client.featureFlag.findFirst({ where: { key } });
    return (flag?.stage as FeatureStage | undefined) ?? item.defaultStage;
  }

  /**
   * 非抛错版判定,供「入口是别的业务动作、门禁只决定是否附带执行」的场景
   * (如作答提交时是否投递拍照预批任务 —— 作答本身不许被 403 打断)。
   */
  async isEnabled(user: JwtUser, key: string): Promise<boolean> {
    const item = featureByKey(key);
    if (!item) return false;
    const stage = await this.stageOf(key);
    if (stage === 'ga') return user.role === item.audienceRole;
    if (stage === 'beta') {
      const hit = await this.prisma.client.featureAccess.findFirst({
        where: { featureKey: key, userId: BigInt(user.uid) },
        select: { id: true },
      });
      return hit != null;
    }
    return false;
  }

  /** 硬门禁:不通过抛 403 FEATURE_NOT_ENABLED(经 BizExceptionFilter 原样下发业务码) */
  async assertEnabled(user: JwtUser, key: string): Promise<void> {
    if (!(await this.isEnabled(user, key))) {
      throw new BizException(ERR_FEATURE_NOT_ENABLED, '该功能未对当前账号开放', { key }, HttpStatus.FORBIDDEN);
    }
  }
}
