/** e2e 配置:连真实 Postgres/Redis(docker-compose.dev.yml),用 seed 数据 */
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  // isolatedModules:e2e 走 transpile-only,与跨任务"契约先行、实现后补"的临时类型错位解耦
  // (本分支基线 c2-contract 已加 unitSeq/openingConfig/analysis*Latex,其实现属 c2-back-redesign 域)。
  // 生产代码类型安全仍由各域的 `nest build` / `tsc --noEmit` 守门,不在 e2e 重复 type-check。
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: true }] },
  moduleNameMapper: {
    '^@qiming/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
  },
  setupFiles: ['dotenv/config'],
  // A7:套件结束先跑 A5 的队列清理(内部 require a5.queue-teardown),再清 a7:ai:* 计量残留
  globalTeardown: '<rootDir>/test/a7.redis-teardown.cjs',
  testTimeout: 30000,
};
