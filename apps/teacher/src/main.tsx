import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from '@qiming/ui';
import { App } from './App';
import './index.css';

// VITE_USE_MOCK !== 'false' 时启用 msw(按 openapi.yaml 全量 mock)
async function prepare(): Promise<void> {
  if (import.meta.env.VITE_USE_MOCK !== 'false') {
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
