import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_OWNER_URL || 'postgresql://hrms_owner:hrms_owner_password@localhost:5432/hrms_db',
  },
  verbose: true,
  strict: true,
});
