import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AssignmentModule } from './assignment/assignment.module';
import { ClassroomModule } from './classroom/classroom.module';
import { AttemptModule } from './attempt/attempt.module';
import { GradingModule } from './grading/grading.module';
import { MasteryModule } from './mastery/mastery.module';
import { WrongBookModule } from './wrongbook/wrongbook.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { maskSensitive } from './common/logging/mask';
import { ContextMiddleware } from './common/middleware/context.middleware';
import { CourseModule } from './course/course.module';
import { KpModule } from './kp/kp.module';
import { LessonModule } from './lesson/lesson.module';
import { PaperModule } from './paper/paper.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuestionModule } from './question/question.module';
import { RedisModule } from './redis/redis.module';
import { ResourceModule } from './resource/resource.module';
import { UploadModule } from './upload/upload.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
        // 宪法 §7:敏感字段不进日志
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          censor: '[redacted]',
        },
        hooks: {
          logMethod(args: unknown[], method: (...a: unknown[]) => void) {
            method.apply(
              this,
              args.map((a) => (typeof a === 'string' ? maskSensitive(a) : a)),
            );
          },
        },
        autoLogging: process.env.NODE_ENV !== 'test',
      },
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET', 'dev-secret-change-me'),
        signOptions: { expiresIn: cfg.get<string>('JWT_ACCESS_TTL', '2h') },
      }),
    }),
    PrismaModule,
    RedisModule,
    AuditModule,
    AiModule,
    AuthModule,
    AdminModule,
    KpModule,
    QuestionModule,
    UploadModule,
    CourseModule,
    LessonModule,
    PaperModule,
    AssignmentModule,
    ResourceModule,
    MasteryModule,
    WrongBookModule,
    GradingModule,
    AttemptModule,
    ClassroomModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ContextMiddleware).forRoutes('*');
  }
}
