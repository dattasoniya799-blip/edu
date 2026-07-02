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
import { markPasswordReset, ttlSeconds } from './pwd-reset';

export interface JwtUser {
  uid: number;
  orgId: number;
  role: Role;
}

const RT_KEY = (jti: string) => `rt:${jti}`;
const RT_USER_KEY = (uid: number) => `rtu:${uid}`;

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

  // ---------------- 学生账号密码登录 ----------------
  async studentLogin(studentNo: string, password: string, ip?: string) {
    return runWithoutTenant(async () => {
      // studentNo 仅 org 内唯一(schema @@unique([orgId, studentNo]));登录请求不带 org,
      // 故取全部同号在读学生逐一用密码定位本人(跨 org 撞号时由密码区分)。
      const candidates = await this.prisma.client.user.findMany({
        where: { studentNo, role: 'student', deletedAt: null },
        include: { org: true },
      });

      let matched: (typeof candidates)[number] | null = null;
      let needsUpgrade = false;
      for (const c of candidates) {
        if (!c.passwordHash) continue;
        const r = await verifyPassword(password, c.passwordHash);
        if (r.ok) {
          matched = c;
          needsUpgrade = r.needsUpgrade;
          break;
        }
      }
      if (!matched) throw new UnauthorizedException('学号或密码错误');
      if (matched.status !== 'active') throw new ForbiddenException('学生账号未激活或已停用');
      if (matched.org.status !== 'active') throw new ForbiddenException('机构已停用');

      // seed/旧 scrypt 哈希 → 首次登录静默升级为 argon2
      if (needsUpgrade) {
        const upgraded = await hashPassword(password);
        await this.prisma.client.user.update({
          where: { id: matched.id },
          data: { passwordHash: upgraded },
        });
      }

      const me = this.buildMe(matched, matched.org);
      const tokens = await this.issueTokens({ uid: me.id, orgId: me.orgId, role: 'student' });
      await this.audit.log({
        actorId: me.id, orgId: me.orgId, action: 'auth.student_login',
        targetType: 'user', targetId: me.id, ip,
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
    await markPasswordReset(this.redis, this.cfg, user.uid); // 旧 access token 也立即失效(守卫拦截)
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
