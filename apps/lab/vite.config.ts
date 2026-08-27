import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../..');

// 本地实验专用(永不部署):端口 5176,不设 VITE_BASE 子路径,不进 deploy。
// /api 代理到本地后端,方便实验直接打真实接口(默认 http://localhost:3000)。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@qiming/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
        '@qiming/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      port: 5176,
      fs: { allow: [workspaceRoot] },
      proxy: {
        '/api': { target: env.VITE_API_TARGET || 'http://localhost:3000', changeOrigin: true },
      },
    },
  };
});
