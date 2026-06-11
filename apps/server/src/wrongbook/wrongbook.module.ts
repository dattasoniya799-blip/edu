import { Module } from '@nestjs/common';
import { AssignmentModule } from '../assignment/assignment.module';
import { WrongBookController } from './wrongbook.controller';
import { WrongBookService } from './wrongbook.service';

/** 错题本(A5):列表 / redo / redo-all + finalize 入账逻辑 */
@Module({
  imports: [AssignmentModule],
  controllers: [WrongBookController],
  providers: [WrongBookService],
  exports: [WrongBookService],
})
export class WrongBookModule {}
