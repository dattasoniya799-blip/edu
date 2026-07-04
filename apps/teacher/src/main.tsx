import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from '@qiming/ui';
import { App } from './App';
import './index.css';

// #9 安全护栏:mock 必须显式 opt-in —— 仅 VITE_USE_MOCK==='true' 才启 MSW。
// 变量未设/拼错 → 走真实后端(fail-safe,杜绝生产漏配静默跑假数据)。
// 本地离线开发的默认 mock 由 .env.development(VITE_USE_MOCK=true)提供。
/**
 * 真实模式启动前:注销往次 mock 模式在浏览器残留的 MSW service worker。
 * 残留 SW 会拦截 /api 请求,但真实模式没有 MSW 客户端应答它 → 请求挂死(表现为"网络波动"/无法提交)。
 * 注销 + 清缓存后重载一次使页面脱离其控制;之后 getRegistrations 为空,不再重载。
 */
async function purgeStaleMockWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    const stale = regs.filter((r) =>
      [r.active, r.installing, r.waiting].some((w) => w?.scriptURL.includes('mockServiceWorker')),
    );
    if (stale.length === 0) return;
    await Promise.all(stale.map((r) => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    console.warn('[mock] 真实模式检测到残留 MSW service worker,已注销并清缓存,重载页面');
    window.location.reload();
    await new Promise<never>(() => {}); // 阻断本次渲染,等重载接管
  } catch {
    /* 注销失败不阻断启动 */
  }
}

async function prepare(): Promise<void> {
  const mockOn = import.meta.env.VITE_USE_MOCK === 'true';
  if (import.meta.env.PROD && mockOn) {
    // 生产构建绝不允许 MSW:宁可炸响也不静默服务假数据
    console.error('[安全] 生产构建检测到 VITE_USE_MOCK=true,已拒绝启动 MSW mock。请移除该变量后重新构建。');
    throw new Error('生产构建不得开启 VITE_USE_MOCK mock');
  }
  if (mockOn) {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
    return;
  }
  // 真实模式:注销往次 mock 残留的 MSW service worker(否则它拦截 /api 却无人应答 → 请求挂死)
  await purgeStaleMockWorker();
}

prepare().then(() => {
  // 子路径部署(构建时 VITE_BASE=/teacher/)时,路由 basename 必须与之匹配,否则刷新/深链失效
  const routerBase = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter basename={routerBase}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </React.StrictMode>,
  );
});
