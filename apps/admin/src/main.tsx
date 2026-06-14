import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from '@qiming/ui';
import { App } from './App';
import './index.css';

// #9 安全护栏:mock 必须显式 opt-in —— 仅 VITE_USE_MOCK==='true' 才启 MSW。
// 变量未设/拼错 → 走真实后端(fail-safe,杜绝生产漏配静默跑假数据)。
// 本地离线开发的默认 mock 由 .env.development(VITE_USE_MOCK=true)提供。
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
  }
}

prepare().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </React.StrictMode>,
  );
});
