import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators';
import { KpNodesQueryDto } from './kp.dto';
import { KpService } from './kp.service';

/** 知识图谱只读接口(openapi:[teacher/admin]) */
@Controller('kp')
@Roles('teacher', 'admin')
export class KpController {
  constructor(private readonly kp: KpService) {}

  @Get('graphs')
  graphs() {
    return this.kp.graphs();
  }

  @Get('nodes')
  nodes(@Query() q: KpNodesQueryDto) {
    return this.kp.nodes(q);
  }
}
