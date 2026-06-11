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
  testTimeout: 30000,
};
