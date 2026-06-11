import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MeDto, Role } from '@qiming/contracts';
import { api, setUnauthorizedHandler } from '../api';
import { getToken, setToken } from './token';

/** 本端角色:学生(平板) */
export const APP_ROLE: Role = 'student';
export const ROLE_LABEL: Record<Role, string> = { admin: '管理员', teacher: '教师', student: '学生' };

/** 设备指纹:首次生成后持久化(扫码兑换 = 绑定设备) */
function deviceFingerprint(): string {
  const KEY = 'qiming.student.device-fp';
  let fp = localStorage.getItem(KEY);
  if (!fp) {
    fp = `fp-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    localStorage.setItem(KEY, fp);
  }
  return fp;
}

interface AuthCtx {
  me: MeDto | null;
  ready: boolean;
  /** 学生登录:扫码/输入登录码,兑换 JWT 并绑定设备(B1 先做输入登录码的形式) */
  loginWithTicket: (ticket: string) => Promise<MeDto>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeDto | null>(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setMe(null);
      navigate('/login', { replace: true });
    });
  }, [navigate]);

  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api.get('/me')
      .then((r) => setMe(r.data))
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  const loginWithTicket = useCallback(async (ticket: string) => {
    const r = await api.post('/auth/student/qr-exchange', {
      body: { token: ticket.trim(), deviceFingerprint: deviceFingerprint(), deviceName: '学生平板(Web)' },
    });
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

  const value = useMemo(() => ({ me, ready, loginWithTicket, logout }), [me, ready, loginWithTicket, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}
