import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { getEnv } from '@hrms/config';
import { createChildLogger } from '../logger/index.js';

let s3ClientInstance: S3Client | null = null;
const ensuredBuckets = new Set<string>();

const logger = createChildLogger({ module: 'storage:s3' });

/**
 * Returns the configured AWS S3 / MinIO client singleton.
 */
export function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    const env = getEnv();
    const protocol = env.MINIO_USE_SSL ? 'https' : 'http';
    const endpoint = `${protocol}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`;

    s3ClientInstance = new S3Client({
      endpoint,
      region: 'us-east-1',
      credentials: {
        accessKeyId: env.MINIO_ACCESS_KEY,
        secretAccessKey: env.MINIO_SECRET_KEY,
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  return s3ClientInstance;
}

/**
 * Ensures that the target MinIO bucket exists, creating it if necessary.
 */
export async function ensureBucketExists(bucket: string): Promise<void> {
  if (ensuredBuckets.has(bucket)) {
    return;
  }

  const s3 = getS3Client();

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    ensuredBuckets.add(bucket);
  } catch (err: unknown) {
    const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: bucket }));
        ensuredBuckets.add(bucket);
        logger.info({ bucket }, 'Created missing MinIO bucket');
      } catch (createErr: unknown) {
        // If another process/worker created it concurrently, treat as success
        const cErr = createErr as { name?: string };
        if (cErr.name === 'BucketAlreadyOwnedByYou' || cErr.name === 'BucketAlreadyExists') {
          ensuredBuckets.add(bucket);
        } else {
          logger.error({ err: createErr, bucket }, 'Failed to create MinIO bucket');
          throw createErr;
        }
      }
    } else {
      logger.error({ err, bucket }, 'Failed to check MinIO bucket existence');
      throw err;
    }
  }
}
