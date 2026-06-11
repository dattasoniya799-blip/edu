import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// VITE_USE_MOCK=false 时,/api 代理到 A1 后端(默认 http://localhost:3000,可用 VITE_API_TARGET 覆盖,如 :3200)
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
      port: 5174,
      proxy: {
        '/api': { target: env.VITE_API_TARGET || 'http://localhost:3000', changeOrigin: true },
      },
    },
  };
});
