import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Use standalone output on Linux/CI/Docker; on Windows local dev without Developer Mode symlinks, fallback to standard output
  output:
    process.env.BUILD_STANDALONE === 'true' || process.platform !== 'win32'
      ? 'standalone'
      : undefined,
  transpilePackages: ['@hrms/config', '@hrms/shared', '@hrms/db', '@hrms/core'],
  serverExternalPackages: ['@node-rs/argon2', 'pg', 'ioredis'],
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    if (isServer) {
      config.externals = [...(config.externals || []), '@node-rs/argon2'];
    }
    return config;
  },
  poweredByHeader: false,
  headers: async () => {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self)',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
