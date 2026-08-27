import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@qiming/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@qiming/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
      // packages/ui 源码直引时,react/katex 一律解析到本应用依赖(避免双 React/jsx-runtime 解析失败)
      'katex/contrib/mhchem': path.resolve(__dirname, 'node_modules/katex/contrib/mhchem/mhchem.js'),
      'katex/dist/katex.min.css': path.resolve(__dirname, 'node_modules/katex/dist/katex.min.css'),
      katex: path.resolve(__dirname, 'node_modules/katex'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react-dom/server': path.resolve(__dirname, 'node_modules/react-dom/server.js'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'node', // 组件用例以 docblock 指定 jsdom(口径同学生端)
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
