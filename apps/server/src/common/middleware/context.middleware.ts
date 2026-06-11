import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { tenantAls } from '../tenant-context';

/** 为每个请求开启 ALS store;JwtAuthGuard 验证后回填 user */
@Injectable()
export class ContextMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction) {
    tenantAls.run({ user: null, bypassTenant: false }, () => next());
  }
}
