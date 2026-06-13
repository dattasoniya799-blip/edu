import { Body, Controller, Get, Param, ParseIntPipe, Put, Query, UseFilters } from '@nestjs/common';
import { Roles } from '../common/decorators';
import { BizExceptionFilter } from '../course/business.exception';
import { ContentPackInputDto, ContentPacksQueryDto } from './knowledge.dto';
import { KnowledgeService } from './knowledge.service';

/** openapi /knowledge/content-packs* [teacher] · 知识点内容库 */
@Controller('knowledge/content-packs')
@Roles('teacher')
@UseFilters(BizExceptionFilter)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list(@Query() q: ContentPacksQueryDto) {
    return this.knowledge.listByGraph(q.graphId);
  }

  @Get(':kpNodeId')
  getOne(@Param('kpNodeId', ParseIntPipe) kpNodeId: number) {
    return this.knowledge.getOne(kpNodeId);
  }

  @Put(':kpNodeId')
  upsert(
    @Param('kpNodeId', ParseIntPipe) kpNodeId: number,
    @Body() dto: ContentPackInputDto,
  ) {
    return this.knowledge.upsert(kpNodeId, dto);
  }
}
