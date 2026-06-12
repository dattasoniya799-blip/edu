import { Module } from '@nestjs/common';
import { AssignmentModule } from '../assignment/assignment.module';
import { GradingModule } from '../grading/grading.module';
import { AttemptController } from './attempt.controller';
import { AttemptService } from './attempt.service';

/** 学生作答(A5):/student/assignments + /student/attempts* */
@Module({
  imports: [AssignmentModule, GradingModule],
  controllers: [AttemptController],
  providers: [AttemptService],
  // [2026-06-12 批准] export 供 ClassroomModule 复用判分口径(A6 曾在自己模块重复 provide,现可移除——留待 A6 维护时清理)
  exports: [AttemptService],
})
export class AttemptModule {}
