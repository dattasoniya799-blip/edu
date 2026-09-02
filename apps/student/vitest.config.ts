import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@qiming/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@qiming/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
      // 旧布局(各目录独立 node_modules)时代这里曾把 react/katex 硬别名到本应用依赖,避免
      // packages/ui 源码直引时出现双 React。npm workspaces(2026-08-31)后全仓只有根 node_modules
      // 一份副本,这些别名反而指向不存在的路径(vi.mock 组件测试报 Failed to resolve "react"),
      // 故删除;dedupe 保留即可保证单实例。
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'node', // 组件/44px 断言用例以 docblock 指定 jsdom
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
