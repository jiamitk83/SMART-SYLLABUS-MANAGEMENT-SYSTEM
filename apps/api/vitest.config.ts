import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/ssms_test',
      JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0123',
      JWT_REFRESH_SECRET: 'test-refresh-secret-test-refresh-secret-01',
      BCRYPT_ROUNDS: '4',
      LOGIN_RATE_MAX: '1000',
    },
  },
});
