/**
 * 内测功能路由守卫(E1):/features/my 里没有这个 key 就不放行,落到统一提示页。
 *
 * 两条拦截路径落同一屏:
 *   ① 进页前 —— 目录里没有该 key(直接敲地址栏、白名单外的教师);
 *   ② 进页后 —— 页内请求收到服务端硬门禁 403 + 4701(目录是拉过的旧快照时会走这条)。
 * ② 由被守卫页面在 catch 里调 useFeatureDeny() 交回来,避免每个页面自己写一遍提示。
 */
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import { Button, Card, EmptyState } from '@qiming/ui';
import { useNavigate } from 'react-router-dom';
import { PageHead } from '../pages/Shell';
import { useFeatures } from './FeaturesProvider';
import { gateState, isFeatureNotEnabled } from './lib/features';

/** 页内请求收到 4701 时回调:返回 true 表示已接管(调用方直接 return,不再弹 toast) */
const DenyCtx = createContext<(e: unknown) => boolean>(() => false);

export function useFeatureDeny(): (e: unknown) => boolean {
  return useContext(DenyCtx);
}

export function FeatureDisabledNotice({ name }: { name: string }) {
  const navigate = useNavigate();
  return (
    <div>
      <PageHead title={name} sub="内测功能 · 按账号白名单开放" />
      <Card>
        <EmptyState
          icon="🧪"
          text="内测功能,请联系管理员开通"
          hint={`「${name}」还在内测阶段,只对白名单账号开放。需要试用请联系机构管理员在「实验室管理」里把你加进白名单。`}
          action={
            <div className="flex flex-wrap justify-center gap-2.5">
              <Button variant="primary" onClick={() => navigate('/lab')}>去实验室看看</Button>
              <Button onClick={() => navigate('/')}>回工作台</Button>
            </div>
          }
        />
      </Card>
    </div>
  );
}

export function FeatureGuard({ featureKey, name, children }: { featureKey: string; name: string; children: ReactNode }) {
  const { features } = useFeatures();
  const [denied, setDenied] = useState(false);
  const deny = useCallback((e: unknown) => {
    if (!isFeatureNotEnabled(e)) return false;
    setDenied(true);
    return true;
  }, []);

  const state = gateState(features, featureKey);
  if (state === 'loading') return <div className="py-10 text-center text-[13px] text-ink-3">加载中…</div>;
  if (state === 'denied' || denied) return <FeatureDisabledNotice name={name} />;
  return <DenyCtx.Provider value={deny}>{children}</DenyCtx.Provider>;
}
