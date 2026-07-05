import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachClassroomMock } from './src/mocks/classroom-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** B6:mock 模式把课堂 WS 假服务挂到 vite dev server(同源 /socket.io,npm run dev 即生效) */
const mockClassroomWs = (enabled: boolean): Plugin => ({
  name: 'qiming-mock-classroom-ws',
  configureServer(server) {
    if (!enabled || !server.httpServer) return;
    attachClassroomMock(server.httpServer as import('node:http').Server);
    server.config.logger.info('  ➜  课堂 WS 假服务已挂载(namespace /classroom · session 401)');
  },
});

// VITE_USE_MOCK=false 时,/api 代理到 A1 后端(默认 http://localhost:3000,可用 VITE_API_TARGET 覆盖,如 :3200);
// 真实模式下 /socket.io 一并代理到后端(A6 网关,ws 升级)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const useMock = env.VITE_USE_MOCK === 'true';
  return {
    plugins: [react(), mockClassroomWs(useMock)],
    resolve: {
      alias: {
        '@qiming/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
        '@qiming/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      port: 5175,
      proxy: {
        '/api': { target: env.VITE_API_TARGET || 'http://localhost:3000', changeOrigin: true },
        ...(useMock ? {} : {
          '/socket.io': { target: env.VITE_API_TARGET || 'http://localhost:3000', changeOrigin: true, ws: true },
        }),
      },
    },
  };
});
