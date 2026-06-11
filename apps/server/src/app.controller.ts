import { Controller, Get, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { Public } from './common/decorators';
import { PrismaService } from './prisma/prisma.service';
import { REDIS } from './redis/redis.module';

@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** 健康检查(免鉴权,不带 /api/v1 前缀) */
  @Public()
  @Get('healthz')
  async healthz() {
    const [db, redis] = await Promise.all([
      this.prisma.healthy(),
      this.redis.ping().then(() => true).catch(() => false),
    ]);
    return { status: db && redis ? 'ok' : 'degraded', db, redis };
  }
}
