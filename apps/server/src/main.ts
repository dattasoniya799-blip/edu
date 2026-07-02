import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { assertProductionEnv } from './common/env-assert';

async function bootstrap() {
  // D2:生产 fail-fast——关键 env 缺失/弱默认即终止启动(.env 已在上方 import AppModule
  // 时经 ConfigModule.forRoot 载入 process.env,此处校验看得到)。非生产为 no-op。
  assertProductionEnv();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // openapi servers: /api/v1;healthz 留在根路径
  app.setGlobalPrefix('api/v1', { exclude: ['healthz'] });

  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  // 「白名单为空 → 放行任意来源」仅限非生产(本地联调);生产 CORS_ORIGINS 已被
  // assertProductionEnv 强制非空,此处理论不可达,空则 origin:false 兜底拒绝。
  const corsOrigin: string[] | boolean =
    origins.length > 0 ? origins : process.env.NODE_ENV !== 'production';
  app.enableCors({ origin: corsOrigin, credentials: true });
  app.enableShutdownHooks();

  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
