import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://hrms_app:hrms_app_password@localhost:5432/hrms_db',
      DATABASE_APP_URL: 'postgresql://hrms_app:hrms_app_password@localhost:5432/hrms_db',
      DATABASE_OWNER_URL: 'postgresql://hrms_owner:hrms_owner_password@localhost:5432/hrms_db',
      REDIS_URL: 'redis://localhost:6379',
      LOG_LEVEL: 'fatal', // Quiet logs during test runs
    },
  },
});
