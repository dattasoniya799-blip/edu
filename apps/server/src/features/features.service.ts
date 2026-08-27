import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminFeatureDto, FeatureStage, MyFeatureDto } from '@qiming/contracts';
import { num } from '../admin/helpers';
import { AuditService } from '../audit/audit.service';
import type { JwtUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { FEATURE_CATALOG, featureByKey } from './feature-catalog';

/**
 * 内测区与功能分级(E1):目录下发 / 管理端阶段切换 / 白名单覆写。
 * 目录是代码内静态注册表(feature-catalog.ts);库里只存覆盖值:
 * feature_flags 无行 = defaultStage;feature_access 仅 beta 生效。
 */
@Injectable()
export class FeaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** GET /features/my:ga(且角色匹配 audienceRole)全下发;beta 仅白名单内;off 不下发 */
  async myFeatures(user: JwtUser): Promise<{ features: MyFeatureDto[] }> {
    const [flags, access] = await Promise.all([
      this.prisma.client.featureFlag.findMany(),
      this.prisma.client.featureAccess.findMany({
        where: { userId: BigInt(user.uid) },
        select: { featureKey: true },
      }),
    ]);
    const stageByKey = new Map(flags.map((f) => [f.key, f.stage as FeatureStage]));
    const mine = new Set(access.map((a) => a.featureKey));
    const features: MyFeatureDto[] = [];
    for (const item of FEATURE_CATALOG) {
      const stage = stageByKey.get(item.key) ?? item.defaultStage;
      if (stage === 'off') continue;
      const visible = stage === 'ga' ? user.role === item.audienceRole : mine.has(item.key);
      if (!visible) continue;
      features.push({ key: item.key, name: item.name, stage, description: item.description });
    }
    return { features };
  }

  /** GET /admin/features:目录全量 + 当前生效 stage + 白名单(userId/姓名/角色) */
  async adminList(): Promise<AdminFeatureDto[]> {
    const [flags, access] = await Promise.all([
      this.prisma.client.featureFlag.findMany(),
      this.prisma.client.featureAccess.findMany({
        orderBy: { userId: 'asc' },
        include: { user: { select: { name: true, role: true } } },
      }),
    ]);
    const stageByKey = new Map(flags.map((f) => [f.key, f.stage as FeatureStage]));
    return FEATURE_CATALOG.map((item) => ({
      key: item.key,
      name: item.name,
      description: item.description,
      audienceRole: item.audienceRole,
      defaultStage: item.defaultStage,
      stage: stageByKey.get(item.key) ?? item.defaultStage,
      whitelist: access
        .filter((a) => a.featureKey === item.key)
        .map((a) => ({ userId: num(a.userId), name: a.user.name, role: a.user.role })),
      knownIssues: [...item.knownIssues],
      acceptance: [...item.acceptance],
    }));
  }

  /** PUT /admin/features/:key:切阶段(未知 key 404;upsert 覆盖行)+ 审计 */
  async setStage(user: JwtUser, key: string, stage: FeatureStage, ip?: string): Promise<null> {
    if (!featureByKey(key)) throw new NotFoundException('功能不存在');
    await this.prisma.client.featureFlag.upsert({
      where: { orgId_key: { orgId: BigInt(user.orgId), key } },
      update: { stage },
      create: { key, stage } as never,
    });
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.feature.stage_update',
      targetType: 'feature_flag', detail: { key, stage }, ip,
    });
    return null;
  }

  /** PUT /admin/features/:key/whitelist:replace 语义整表覆写;校验同机构用户;+ 审计 */
  async setWhitelist(user: JwtUser, key: string, userIds: number[], ip?: string): Promise<null> {
    if (!featureByKey(key)) throw new NotFoundException('功能不存在');
    const ids = [...new Set(userIds)].map((id) => BigInt(id));
    if (ids.length) {
      // 租户注入自动限定本机构:数目不齐 = 含跨机构或不存在的用户
      const found = await this.prisma.client.user.count({ where: { id: { in: ids } } });
      if (found !== ids.length) throw new BadRequestException('白名单只能包含本机构用户');
    }
    await this.prisma.client.$transaction(async (tx) => {
      await tx.featureAccess.deleteMany({ where: { featureKey: key } });
      if (ids.length) {
        await tx.featureAccess.createMany({
          data: ids.map((userId) => ({ featureKey: key, userId })) as never,
        });
      }
    });
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'admin.feature.whitelist_update',
      targetType: 'feature_access', detail: { key, userIds: ids.map((id) => num(id)) }, ip,
    });
    return null;
  }
}
