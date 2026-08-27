import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary, ToastProvider } from '@qiming/ui';
import { App } from './App';
import './index.css';

// 本地实验区:不挂路由、不挂 msw —— 实验自带假数据或直连本地后端(vite proxy /api)
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
