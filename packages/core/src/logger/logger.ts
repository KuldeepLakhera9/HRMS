import pino from 'pino';
import { getEnv } from '@hrms/config';

let rootLogger: pino.Logger | null = null;

export const REDACTION_PATHS = [
  'password',
  'password_hash',
  'passwordHash',
  'token',
  'token_hash',
  'tokenHash',
  'refresh_token',
  'refreshToken',
  'mfa_secret',
  'mfaSecret',
  'mfa_secret_enc',
  'pan',
  'pan_enc',
  'aadhaar',
  'aadhaar_enc',
  'bank_enc',
  'account_number',
  'accountNumber',
  'bankAccountNumber',
  'bank_account_number',
  'uan',
  'uan_enc',
  'uanEnc',
  'salary',
  'basicSalary',
  'netPay',
  'net_pay',
  'grossPay',
  'gross_pay',
  'ctc',
  'ctc_annual',
  'annualCtc',
  'ifsc',
  'ifscCode',
  '*.password',
  '*.token',
  '*.uan',
  '*.uan_enc',
  'authorization',
  'headers.authorization',
  'headers.cookie',
];

export function getLogger(): pino.Logger {
  if (!rootLogger) {
    const env = getEnv();
    const isDev = env.NODE_ENV === 'development';
    const isNext = typeof process !== 'undefined' && (Boolean(process.env.NEXT_RUNTIME) || Boolean(process.env.__NEXT_PROCESSED_ENV));

    const pinoOptions: pino.LoggerOptions = {
      level: env.LOG_LEVEL,
      redact: {
        paths: REDACTION_PATHS,
        censor: '[REDACTED]',
      },
      base: {
        env: env.NODE_ENV,
      },
      ...(isDev && !isNext
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            },
          }
        : {}),
    };

    rootLogger = pino(pinoOptions);
  }
  return rootLogger;
}

export interface LogContext {
  requestId?: string | undefined;
  companyId?: string | undefined;
  userId?: string | undefined;
  module?: string | undefined;
  [key: string]: unknown;
}

export function createChildLogger(ctx: LogContext): pino.Logger {
  return getLogger().child(ctx);
}
