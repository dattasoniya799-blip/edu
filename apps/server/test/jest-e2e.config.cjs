/** e2e 配置:连真实 Postgres/Redis(docker-compose.dev.yml),用 seed 数据 */
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleNameMapper: {
    '^@qiming/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
  },
  setupFiles: ['dotenv/config'],
  // A7:套件结束先跑 A5 的队列清理(内部 require a5.queue-teardown),再清 a7:ai:* 计量残留
  globalTeardown: '<rootDir>/test/a7.redis-teardown.cjs',
  testTimeout: 30000,
};
