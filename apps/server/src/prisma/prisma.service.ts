import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { currentOrgId, isTenantBypassed } from '../common/tenant-context';

/**
 * 租户注入(宪法 §4 机制红线):
 * - 带 org_id 的模型:读/改/删自动 AND { orgId },create/createMany 自动填充 orgId
 *   (Prisma 5 whereUnique 允许附加非唯一条件,update/delete 同样生效)
 * - Org 模型本身无 org_id:一律限定 id = 当前 orgId
 * - 无上下文且未显式 bypass → 抛错,从机制上杜绝"忘了带租户"的查询
 */

/** 无 org_id 字段的模型 */
const ORG_MODEL = 'Org';

const READ_OPS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy',
]);
const WRITE_WHERE_OPS = new Set(['update', 'updateMany', 'delete', 'deleteMany']);

function tenantExtension() {
  return Prisma.defineExtension({
    name: 'tenant-injection',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (isTenantBypassed()) return query(args);
          const orgId = currentOrgId();
          if (orgId == null) {
            throw new Error(`[tenant] ${model}.${operation} 在无租户上下文中执行,已拒绝`);
          }
          const a: any = args ?? {};
          if (model === ORG_MODEL) {
            // Org 表用主键限定本机构
            if (READ_OPS.has(operation) || WRITE_WHERE_OPS.has(operation)) {
              a.where = { ...(a.where ?? {}), id: orgId };
            }
            return query(a);
          }
          if (READ_OPS.has(operation) || WRITE_WHERE_OPS.has(operation)) {
            a.where = { ...(a.where ?? {}), orgId };
          } else if (operation === 'create') {
            a.data = { ...(a.data ?? {}), orgId };
          } else if (operation === 'createMany') {
            const data = Array.isArray(a.data) ? a.data : [a.data];
            a.data = data.map((d: any) => ({ ...d, orgId }));
          } else if (operation === 'upsert') {
            a.where = { ...(a.where ?? {}), orgId };
            a.create = { ...(a.create ?? {}), orgId };
          }
          return query(a);
        },
      },
    },
  });
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly base = new PrismaClient();
  /** 业务代码统一使用 client(已带租户注入) */
  readonly client = this.base.$extends(tenantExtension());

  async onModuleInit() {
    await this.base.$connect();
  }
  async onModuleDestroy() {
    await this.base.$disconnect();
  }
  async healthy(): Promise<boolean> {
    try {
      await this.base.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

export type TenantClient = PrismaService['client'];
