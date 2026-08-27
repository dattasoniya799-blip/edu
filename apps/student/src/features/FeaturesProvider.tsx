/**
 * 内测功能目录(E1)· 进 app 后拉一次 GET /features/my,内存缓存到退出登录为止。
 *
 * 学生端目前只有「拍照预批」一个门禁项(默认 off = 对所有人隐藏预批展示)。
 * 拉取失败按「无内测条目」处理:入口少了不影响作答,真正的边界在服务端。
 * 注意:被门禁的只是「AI 预批」这层展示,拍照上传作为作答附件的能力始终可用。
 */
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { MyFeatureDto } from '@qiming/contracts';
import { api } from '../api';
import { useAuth } from '../auth/AuthProvider';

export const FEATURE_PHOTO_PREGRADE = 'photo_pregrade';

let cache: MyFeatureDto[] | null = null;

interface FeaturesCtx {
  /** null = 目录还没到 */
  features: MyFeatureDto[] | null;
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
    has: (key: string) => (features ?? []).some((f) => f.key === key),
  }), [features]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFeatures(): FeaturesCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFeatures 必须在 <FeaturesProvider> 内使用');
  return ctx;
}
