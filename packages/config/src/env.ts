import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Database Connections (PostgreSQL)
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_APP_URL: z.string().min(1, 'DATABASE_APP_URL is required'),
  DATABASE_OWNER_URL: z.string().min(1, 'DATABASE_OWNER_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // MinIO / S3
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z
    .enum(['true', 'false', '1', '0'])
    .transform(v => v === 'true' || v === '1')
    .default('false'),
  MINIO_ACCESS_KEY: z.string().default('minio_admin'),
  MINIO_SECRET_KEY: z.string().default('minio_dev_password'),
  MINIO_BUCKET_DOCUMENTS: z.string().default('hrms-documents'),
  MINIO_BUCKET_EXPORTS: z.string().default('hrms-exports'),

  // Email (SMTP / Mailpit)
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().default('no-reply@hrms.internal'),

  // Observability & Security
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

function autoLoadEnv(): void {
  if (typeof process.loadEnvFile === 'function') {
    let currentDir = process.cwd();
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(currentDir, '.env');
      if (fs.existsSync(candidate)) {
        try {
          process.loadEnvFile(candidate);
          break;
        } catch {
          // ignore if unreadable or already loaded
        }
      }
      const parent = path.dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }
  }
}

/**
 * Validates and returns the strongly-typed environment configuration.
 * Fails fast and throws a detailed error if any required variables are missing or invalid.
 */
export function validateEnv(rawEnv: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const formattedErrors = result.error.errors
      .map(err => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(
      `[Config Error] Invalid environment variables:\n${formattedErrors}\nReview your .env configuration.`,
    );
  }

  return result.data;
}

/**
 * Returns cached validated environment configuration.
 */
export function getEnv(): Env {
  if (!cachedEnv) {
    if (!process.env.DATABASE_URL) {
      autoLoadEnv();
    }
    cachedEnv = validateEnv(process.env);
  }
  return cachedEnv;
}
