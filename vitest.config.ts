import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      '@hrms/config': path.resolve(__dirname, './packages/config/src/index.ts'),
      '@hrms/shared': path.resolve(__dirname, './packages/shared/src/index.ts'),
      '@hrms/db/schema': path.resolve(__dirname, './packages/db/src/schema/index.ts'),
      '@hrms/db': path.resolve(__dirname, './packages/db/src/index.ts'),
      '@hrms/core': path.resolve(__dirname, './packages/core/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'tests/integration/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://hrms_app:hrms_app_password@localhost:5433/hrms_db',
      DATABASE_APP_URL: 'postgresql://hrms_app:hrms_app_password@localhost:5433/hrms_db',
      DATABASE_OWNER_URL: 'postgresql://hrms_owner:hrms_owner_password@localhost:5433/hrms_db',
      REDIS_URL: 'redis://localhost:6379',
      LOG_LEVEL: 'fatal',
    },
  },
});
