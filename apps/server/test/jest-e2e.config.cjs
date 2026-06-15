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
  // 默认 no-op;仅当 E2E_LLM_ISOLATION=1(与演示并跑时)复位 LLM 环境,挡住 Prisma 从主 .env 回灌真实 key
  setupFilesAfterEnv: ['<rootDir>/test/llm-env-isolation.cjs'],
  // A7:套件结束先跑 A5 的队列清理(内部 require a5.queue-teardown),再清 a7:ai:* 计量残留
  globalTeardown: '<rootDir>/test/a7.redis-teardown.cjs',
  testTimeout: 30000,
};
