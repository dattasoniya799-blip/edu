/**
 * 内测功能目录(E1)· 进 app 后拉一次 GET /features/my,内存缓存到退出登录为止。
 *
 * 缓存放模块级而不是 state:同一次会话内跨路由/重挂载都不再重复请求(刷新页面即失效,
 * 与「stage 变更后重新登录/刷新生效」的口径一致)。拉取失败按「无内测条目」处理 ——
 * 目录拿不到时最坏结果只是入口少了,真正的安全边界在服务端 403。
 */
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { MyFeatureDto } from '@qiming/contracts';
import { api } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { hasFeature, labEntries, type LabEntry } from './lib/features';

let cache: MyFeatureDto[] | null = null;

interface FeaturesCtx {
  /** null = 目录还没到(守卫据此显示加载态,不能当成「无权限」) */
  features: MyFeatureDto[] | null;
  labEntries: LabEntry[];
  has: (key: string) => boolean;
}

const Ctx = createContext<FeaturesCtx | null>(null);

export function FeaturesProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [features, setFeatures] = useState<MyFeatureDto[] | null>(cache);

  useEffect(() => {
    if (!me) { cache = null; setFeatures(null); return; }
    if (cache) { setFeatures(cache); return; }
    let alive = true;
    api.get('/features/my')
      .then((r) => { cache = r.data.features; if (alive) setFeatures(cache); })
      .catch(() => { cache = []; if (alive) setFeatures([]); });
    return () => { alive = false; };
  }, [me]);

  const value = useMemo<FeaturesCtx>(() => ({
    features,
    labEntries: labEntries(features ?? []),
    has: (key: string) => hasFeature(features ?? [], key),
  }), [features]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFeatures(): FeaturesCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFeatures 必须在 <FeaturesProvider> 内使用');
  return ctx;
}
