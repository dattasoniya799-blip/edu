/**
 * 测试专用探针控制器(仅 e2e 挂载,不进生产代码):
 * - /admin/__probe       验证 @Roles('admin') 门禁(teacher → 403)
 * - /__probe/users/:id   验证租户注入(跨机构查询 → 404)
 * 不属于 openapi 契约,A2 落地真实 /admin/* 后,403 用例可平移。
 */
import { Controller, Get, Module, NotFoundException, Param } from '@nestjs/common';
import { Roles } from '../../src/common/decorators';
import { PrismaService } from '../../src/prisma/prisma.service';

@Controller('admin')
@Roles('admin')
class AdminProbeController {
  @Get('__probe')
  probe() {
    return { ok: true };
  }
}

@Controller('__probe')
class TenantProbeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('users/:id')
  async user(@Param('id') id: string) {
    // 走租户注入后的 client:他org 的 id 查不到 → 404
    const u = await this.prisma.client.user.findFirst({ where: { id: BigInt(id) } });
    if (!u) throw new NotFoundException('资源不存在');
    return { id: Number(u.id), name: u.name };
  }
}

@Module({ controllers: [AdminProbeController, TenantProbeController] })
export class ProbeModule {}
