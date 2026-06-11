import { Inject, OnApplicationShutdown } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Namespace, Socket } from 'socket.io';
import type { JwtUser } from '../auth/auth.service';
import { runAsUser } from '../common/tenant-context';
import { REDIS } from '../redis/redis.module';
import { ClassroomService } from './classroom.service';

/**
 * /classroom 网关(设计文档 7.2/7.3):
 * - 握手鉴权:auth.token = JWT(对齐 JwtAuthGuard 口径,拒绝 refresh 令牌);
 *   本课成员校验在 class:join(此时才有 sessionId)
 * - 心跳:服务端 ping 25s(7.2);客户端业务心跳 class:heartbeat 10s 驱动 stuck 检测
 * - Redis adapter:MVP 单实例也先接上(7.2,多实例零成本切换)
 *
 * 实现说明:事件处理器用原生 socket.on 注册而非 @SubscribeMessage——
 * A1 的全局 APP_GUARD/APP_INTERCEPTOR(JwtAuthGuard/TransformInterceptor)同样作用于
 * WS 消息处理器,会破坏契约 ack 形状(包一层 {code,message,data})且无法读 WS 握手头;
 * A1 代码本任务禁改,故在网关内自管鉴权/租户上下文/异常通道(emit 'exception'),
 * 事件名与负载形状逐字遵守 ws-protocol.ts。
 */
@WebSocketGateway({
  namespace: '/classroom',
  pingInterval: 25_000, // 7.2:心跳 25s
  pingTimeout: 20_000,
  cors: { origin: true, credentials: true },
})
export class ClassroomGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  private pub: Redis | null = null;
  private sub: Redis | null = null;

  constructor(
    private readonly jwt: JwtService,
    private readonly svc: ClassroomService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  afterInit(nsp: Namespace) {
    // Redis adapter(多实例广播;MVP 单实例先接上,7.2)
    try {
      this.pub = this.redis.duplicate();
      this.sub = this.redis.duplicate();
      const factory = createAdapter(this.pub, this.sub) as unknown as (n: Namespace) => unknown;
      (nsp.server as unknown as { adapter: (f: unknown) => void }).adapter(factory); // 后续命名空间
      (nsp as unknown as { adapter: unknown }).adapter = factory(nsp); // 当前命名空间(连接建立前替换)
    } catch {
      this.pub?.disconnect();
      this.sub?.disconnect();
      this.pub = this.sub = null; // 降级为内存 adapter(单实例等价)
    }

    // 握手 JWT 鉴权(7.2)
    nsp.use(async (socket, next) => {
      try {
        const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
        if (!token) return next(new Error('未登录'));
        const payload = await this.jwt.verifyAsync(token);
        if (payload?.typ === 'refresh') return next(new Error('凭证类型错误'));
        socket.data.user = {
          uid: Number(payload.uid),
          orgId: Number(payload.orgId),
          role: payload.role,
        } satisfies JwtUser;
        next();
      } catch {
        next(new Error('凭证无效或已过期'));
      }
    });

    this.svc.setServer(nsp);
  }

  handleConnection(socket: Socket) {
    const user = socket.data.user as JwtUser;
    // C→S 事件(ws-protocol.ts C2SEvents,事件名/负载逐字)
    this.on(socket, 'class:join', (p) => this.svc.join(user, socket, p as { sessionId: number }));
    this.on(socket, 'class:segment', (p) => this.svc.segment(user, socket, p as { segmentSeq: number }));
    this.on(socket, 'class:answer', (p) =>
      this.svc.answer(user, socket, p as { questionId: number; response: Record<string, unknown> }),
    );
    this.on(socket, 'class:ai_ask', (p) =>
      this.svc.aiAsk(user, socket, p as { questionId: number | null; message: string }),
    );
    this.on(socket, 'class:hand_up', () => this.svc.handUp(user, socket));
    this.on(socket, 'class:heartbeat', (p) =>
      this.svc.heartbeat(user, socket, p as { currentQuestion: number | null; idleSec: number }),
    );
    // 教师控制通道:契约只定义了 S→C class:control,C→S 方向缺失(已在 README 提出
    // 契约变更申请);服务端复用同名事件 + ClassControl 负载形状接收教师指令,
    // 下行广播严格按 S2CEvents['class:control']。
    this.on(socket, 'class:control', (p) => this.svc.control(user, socket, p as never));
  }

  handleDisconnect(socket: Socket) {
    const user = socket.data.user as JwtUser | undefined;
    if (!user) return;
    runAsUser(user, () => this.svc.onDisconnect(user, socket)).catch(() => undefined);
  }

  /** 在 io server 关闭之后再断 adapter 客户端(否则 server.close 的 adapter 收尾命令会打在已关连接上) */
  async onApplicationShutdown() {
    await this.pub?.quit().catch(() => undefined);
    await this.sub?.quit().catch(() => undefined);
  }

  /** 统一包装:租户上下文(runAsUser,机制对齐 ContextMiddleware)+ ack + 异常通道 */
  private on(
    socket: Socket,
    event: string,
    handler: (payload: unknown) => Promise<unknown> | unknown,
  ): void {
    socket.on(event, async (...args: unknown[]) => {
      const ack =
        typeof args[args.length - 1] === 'function'
          ? (args.pop() as (resp: unknown) => void)
          : undefined;
      try {
        const user = socket.data.user as JwtUser;
        const result = await runAsUser(user, async () => handler(args[0] ?? {}));
        if (ack && result !== undefined) ack(result);
      } catch (e) {
        if (process.env.CLS_DEBUG) console.error('[cls-debug]', event, e);
        // 业务/校验异常 → 'exception'(消息不含敏感字段;宪法 §7)
        socket.emit('exception', {
          status: 'error',
          message: e instanceof Error ? e.message : '服务异常',
        });
      }
    });
  }
}
