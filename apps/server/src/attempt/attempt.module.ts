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
})
export class AttemptModule {}
