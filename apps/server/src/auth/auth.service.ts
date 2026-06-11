import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type Redis from 'ioredis';
import type { MeDto, OrgSettings, Role } from '@qiming/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { AuditService } from '../audit/audit.service';
import { runWithoutTenant } from '../common/tenant-context';
import { hashPassword, randomToken, verifyPassword } from './password.util';

export interface JwtUser {
  uid: number;
  orgId: number;
  role: Role;
}

const RT_KEY = (jti: string) => `rt:${jti}`;
const RT_USER_KEY = (uid: number) => `rtu:${uid}`;

/** '2h' / '14d' / '900s' → 秒 */
function ttlSeconds(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) return 7200;
  const n = Number(m[1]);
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd'];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // ---------------- 登录(admin/teacher) ----------------
  async login(phone: string, password: string, ip?: string) {
    const user = await runWithoutTenant(() =>
      this.prisma.client.user.findFirst({
        where: {
          phone,
          role: { in: ['admin', 'teacher'] },
          status: 'active',
          deletedAt: null,
        },
        include: { org: true },
      }),
    );
    if (!user?.passwordHash) throw new UnauthorizedException('账号或密码错误');
    if (user.org.status !== 'active') throw new ForbiddenException('机构已停用');

    const { ok, needsUpgrade } = await verifyPassword(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('账号或密码错误');

    // seed 的 scrypt 哈希 → 首次登录静默升级为 argon2
    if (needsUpgrade) {
      const upgraded = await hashPassword(password);
      await runWithoutTenant(() =>
        this.prisma.client.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } }),
      );
    }

    const me = this.buildMe(user, user.org);
    const tokens = await this.issueTokens({ uid: me.id, orgId: me.orgId, role: me.role });
    await this.audit.log({
      actorId: me.id, orgId: me.orgId, action: 'auth.login',
      targetType: 'user', targetId: me.id, detail: { role: me.role }, ip,
    });
    return { ...tokens, me };
  }

  // ---------------- 平板扫码兑换(student) ----------------
  async qrExchange(token: string, deviceFingerprint: string, deviceName: string, ip?: string) {
    return runWithoutTenant(async () => {
      const ticket = await this.prisma.client.loginTicket.findFirst({ where: { token } });
      if (!ticket || ticket.expiresAt < new Date()) throw new UnauthorizedException('登录码无效或已过期');

      // 一次性:原子置 used_at,谁抢到算谁(防并发重放)
      const claimed = await this.prisma.client.loginTicket.updateMany({
        where: { id: ticket.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new UnauthorizedException('登录码已被使用');

      const student = await this.prisma.client.user.findFirst({
        where: { id: ticket.studentId, role: 'student', deletedAt: null },
        include: { org: true, device: true },
      });
      if (!student || student.status === 'disabled') throw new UnauthorizedException('学生账号不可用');
      if (student.org.status !== 'active') throw new ForbiddenException('机构已停用');

      // 设备绑定:一人一机;换设备需管理员先解绑
      const settings = student.org.settings as Record<string, any>;
      if (student.device) {
        if (settings?.deviceBinding !== false && student.device.deviceFingerprint !== deviceFingerprint) {
          throw new ForbiddenException('该学生已绑定其他设备,请联系管理员解绑后重试');
        }
        await this.prisma.client.device.update({
          where: { id: student.device.id },
          data: { lastSeenAt: new Date(), deviceName },
        });
      } else {
        await this.prisma.client.device.create({
          data: { orgId: student.orgId, studentId: student.id, deviceFingerprint, deviceName },
        });
      }

      // 学生首次登录自动激活
      if (student.status === 'pending') {
        await this.prisma.client.user.update({ where: { id: student.id }, data: { status: 'active' } });
      }

      const me = this.buildMe(student, student.org);
      const tokens = await this.issueTokens({ uid: me.id, orgId: me.orgId, role: 'student' });
      await this.audit.log({
        actorId: me.id, orgId: me.orgId, action: 'auth.qr_exchange',
        targetType: 'device', detail: { deviceName }, ip,
      });
      return { ...tokens, me };
    });
  }

  // ---------------- 刷新轮换 ----------------
  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(refreshToken);
    } catch {
      throw new UnauthorizedException('刷新令牌无效或已过期');
    }
    if (payload.typ !== 'refresh' || !payload.jti) throw new UnauthorizedException('刷新令牌无效');

    // 轮换:旧 jti 原子作废(重放 → 401)
    const stored = await this.redis.getdel(RT_KEY(payload.jti));
    if (!stored) throw new UnauthorizedException('刷新令牌已失效');
    await this.redis.srem(RT_USER_KEY(Number(payload.uid)), payload.jti);

    return this.issueTokens({ uid: Number(payload.uid), orgId: Number(payload.orgId), role: payload.role });
  }

  // ---------------- 退出 ----------------
  async logout(user: JwtUser) {
    await this.revokeAllRefreshTokens(user.uid);
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'auth.logout',
      targetType: 'user', targetId: user.uid,
    });
  }

  // ---------------- 当前用户(走租户注入) ----------------
  async me(user: JwtUser): Promise<MeDto> {
    const u = await this.prisma.client.user.findFirst({
      where: { id: user.uid, deletedAt: null },
      include: { org: true },
    });
    if (!u) throw new NotFoundException('用户不存在');
    return this.buildMe(u, u.org);
  }

  // ---------------- 修改密码 ----------------
  async changePassword(user: JwtUser, oldPassword: string, newPassword: string, ip?: string) {
    const u = await this.prisma.client.user.findFirst({ where: { id: user.uid, deletedAt: null } });
    if (!u?.passwordHash) throw new ForbiddenException('当前账号不支持密码登录');
    const { ok } = await verifyPassword(oldPassword, u.passwordHash);
    if (!ok) throw new UnauthorizedException('原密码错误');

    await this.prisma.client.user.update({
      where: { id: u.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    await this.revokeAllRefreshTokens(user.uid); // 改密后所有刷新令牌作废
    await this.audit.log({
      actorId: user.uid, orgId: user.orgId, action: 'me.password_change',
      targetType: 'user', targetId: user.uid, ip,
    });
  }

  // ---------------- 内部 ----------------
  private buildMe(u: { id: bigint; orgId: bigint; role: Role; name: string }, org: { name: string; settings: unknown }): MeDto {
    return {
      id: Number(u.id),
      orgId: Number(u.orgId),
      role: u.role,
      name: u.name,
      orgName: org.name,
      orgSettings: org.settings as OrgSettings,
    };
  }

  private async issueTokens(user: JwtUser) {
    const accessTtl = this.cfg.get<string>('JWT_ACCESS_TTL', '2h');
    const refreshTtl = this.cfg.get<string>('JWT_REFRESH_TTL', '14d');
    const jti = randomToken(16);

    const accessToken = await this.jwt.signAsync(
      { uid: user.uid, orgId: user.orgId, role: user.role },
      { expiresIn: accessTtl },
    );
    const refreshToken = await this.jwt.signAsync(
      { uid: user.uid, orgId: user.orgId, role: user.role, typ: 'refresh', jti },
      { expiresIn: refreshTtl },
    );

    const ttl = ttlSeconds(refreshTtl);
    await this.redis.set(RT_KEY(jti), JSON.stringify(user), 'EX', ttl);
    await this.redis.sadd(RT_USER_KEY(user.uid), jti);
    await this.redis.expire(RT_USER_KEY(user.uid), ttl);
    return { accessToken, refreshToken };
  }

  private async revokeAllRefreshTokens(uid: number) {
    const jtis = await this.redis.smembers(RT_USER_KEY(uid));
    if (jtis.length) await this.redis.del(...jtis.map(RT_KEY));
    await this.redis.del(RT_USER_KEY(uid));
  }
}
