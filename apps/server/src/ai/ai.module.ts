import { Global, Module } from '@nestjs/common';
import type Redis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { AiAdminService } from './ai-admin.service';
import { AiController } from './ai.controller';
import { CompanionService } from './features/companion.service';
import { DiagnosisService } from './features/diagnosis.service';
import { LlmPreGradeGateway } from './features/pre-grading.gateway';
import { QaService } from './features/qa.service';
import { LlmGatewayService } from './llm/llm-gateway.service';
import { MockProvider } from './llm/providers/mock.provider';
import { OpenAiCompatibleProvider } from './llm/providers/openai-compatible.provider';
import { RouteTableService } from './llm/route-table.service';
import { LocalOcrStub, OCR_SERVICE } from './ocr/ocr.service';

/**
 * AI 网关域(任务卡 A7):供应商抽象 + 路由表 + 计量/额度护栏 + 四能力。
 * - @Global:同 RedisModule 口径的横切服务 —— GradingModule 把 AI_GATEWAY token
 *   绑到本模块导出的 LlmPreGradeGateway(useExisting)即可,无需 imports;
 * - 供应商注册制(工厂内同步 register,A5 worker 起跑前即就绪):
 *   mock(验收用,确定性)+ openai_compatible(真实适配器,原生 fetch,
 *   env 读 LLM_API_KEY/LLM_BASE_URL/LLM_MODEL,不写死厂商);
 * - 课堂伴学(CompanionService)/学情诊断(DiagnosisService)模板版导出,
 *   供 classroom 等后续任务接线(本卡不改 classroom)。
 */
@Global()
@Module({
  controllers: [AiController],
  providers: [
    RouteTableService,
    MockProvider,
    OpenAiCompatibleProvider,
    {
      provide: LlmGatewayService,
      inject: [PrismaService, RouteTableService, AuditService, REDIS, MockProvider, OpenAiCompatibleProvider],
      useFactory: (
        prisma: PrismaService,
        routes: RouteTableService,
        audit: AuditService,
        redis: Redis,
        mock: MockProvider,
        openai: OpenAiCompatibleProvider,
      ) => {
        const gateway = new LlmGatewayService(prisma, routes, audit, redis);
        gateway.register(mock);
        gateway.register(openai);
        return gateway;
      },
    },
    { provide: OCR_SERVICE, useClass: LocalOcrStub },
    LlmPreGradeGateway,
    QaService,
    CompanionService,
    DiagnosisService,
    AiAdminService,
  ],
  exports: [
    LlmGatewayService,
    LlmPreGradeGateway,
    CompanionService,
    DiagnosisService,
    OpenAiCompatibleProvider,
    AiAdminService,
  ],
})
export class AiModule {}
