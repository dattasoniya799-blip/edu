import { Module } from '@nestjs/common';
import { AssignmentController } from './assignment.controller';
import { AssignmentService } from './assignment.service';

@Module({
  controllers: [AssignmentController],
  providers: [AssignmentService],
  /** listForStudent 供 A5 学生域复用(目标解析唯一口径) */
  exports: [AssignmentService],
})
export class AssignmentModule {}
