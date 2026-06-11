import { Module } from '@nestjs/common';
import { AssignmentModule } from '../assignment/assignment.module';
import { AttemptService } from '../attempt/attempt.service';
import { GradingModule } from '../grading/grading.module';
import { ClassroomGateway } from './classroom.gateway';
import { ClassroomService } from './classroom.service';

/**
 * 课堂实时(A6):/classroom 命名空间。
 * - class:answer 判分复用 A5 AttemptService(其依赖 AssignmentService / GradingService /
 *   PreGradingQueueService 分别由 AssignmentModule、GradingModule 导出),禁止重写口径;
 *   A5 的 AttemptModule 未导出该服务,故在本模块按同一类再提供一份(无状态,零改动 A5 代码)
 * - ended 结算的课后作业发布调 A4 AssignmentService.create(禁止重写发布逻辑)
 */
@Module({
  imports: [AssignmentModule, GradingModule],
  providers: [ClassroomService, ClassroomGateway, AttemptService],
})
export class ClassroomModule {}
