import { Module } from '@nestjs/common';
import { CourseLessonsController, LessonController } from './lesson.controller';
import { LessonService } from './lesson.service';

@Module({
  controllers: [CourseLessonsController, LessonController],
  providers: [LessonService],
})
export class LessonModule {}
