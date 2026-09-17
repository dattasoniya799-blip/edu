import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const SERVER = 'http://localhost:4310';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4311,
    strictPort: true,
    // shared/ 在 web/ 之外:类型与 sample 夹具都从那儿直接读
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/assets': { target: SERVER, changeOrigin: true },
      // 首页「示例题目 · 一键试讲」的题目图(server/src/samples.ts 托管 ../题目/)
      '/samples': { target: SERVER, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
