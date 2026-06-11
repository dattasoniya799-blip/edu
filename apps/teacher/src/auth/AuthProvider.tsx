import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MeDto, Role } from '@qiming/contracts';
import { api, setUnauthorizedHandler } from '../api';
import { getToken, setToken } from './token';

/** 本端角色:教师 */
export const APP_ROLE: Role = 'teacher';
export const ROLE_LABEL: Record<Role, string> = { admin: '管理员', teacher: '教师', student: '学生' };

interface AuthCtx {
  me: MeDto | null;
  /** 初始化(本地 token 校验)是否完成 */
  ready: boolean;
  loginWithPassword: (phone: string, password: string) => Promise<MeDto>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeDto | null>(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  // 401 统一处理:清 token → 跳登录
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setMe(null);
      navigate('/login', { replace: true });
    });
  }, [navigate]);

  // 启动时若有本地 token,拉 /me 恢复会话
  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api.get('/me')
      .then((r) => setMe(r.data))
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  const loginWithPassword = useCallback(async (phone: string, password: string) => {
    const r = await api.post('/auth/login', { body: { phone, password } });
    const { accessToken, me: who } = r.data;
    if (who.role !== APP_ROLE) {
      throw new Error(`该账号是${ROLE_LABEL[who.role]}账号,请前往${ROLE_LABEL[who.role]}端登录`);
    }
    setToken(accessToken);
    setMe(who);
    return who;
  }, []);

  const logout = useCallback(() => {
    api.post('/auth/logout').catch(() => undefined);
    setToken(null);
    setMe(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  const value = useMemo(() => ({ me, ready, loginWithPassword, logout }), [me, ready, loginWithPassword, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}
