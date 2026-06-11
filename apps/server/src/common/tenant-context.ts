import { AsyncLocalStorage } from 'async_hooks';
import type { Role } from '@qiming/contracts';

/** 请求级租户上下文:JwtAuthGuard 验证通过后写入,PrismaService 据此注入 org_id */
export interface TenantStore {
  user: { uid: number; orgId: number; role: Role } | null;
  /** 仅认证流程(登录前不知道 org)允许绕过注入 */
  bypassTenant: boolean;
}

export const tenantAls = new AsyncLocalStorage<TenantStore>();

export function currentUser() {
  return tenantAls.getStore()?.user ?? null;
}

export function currentOrgId(): number | null {
  return tenantAls.getStore()?.user?.orgId ?? null;
}

export function isTenantBypassed(): boolean {
  return tenantAls.getStore()?.bypassTenant ?? false;
}

/**
 * 在无租户上下文中执行(仅 auth 登录/兑换流程使用,业务代码禁止调用)。
 * 注意:内部用 async 包装并 await,保证 PrismaPromise(惰性,await 时才真正执行)
 * 在 ALS 上下文内被驱动——否则 bypass 会在外层 await 时丢失。
 */
export function runWithoutTenant<T>(fn: () => Promise<T> | T): Promise<T> {
  return tenantAls.run({ user: null, bypassTenant: true }, async () => await fn());
}

/** 审计/测试/任务场景:以指定身份执行(同样在上下文内驱动 Promise) */
export function runAsUser<T>(user: TenantStore['user'], fn: () => Promise<T> | T): Promise<T> {
  return tenantAls.run({ user, bypassTenant: false }, async () => await fn());
}
