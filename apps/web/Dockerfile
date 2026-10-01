# ==============================================================================
# Multi-Stage Production Dockerfile for apps/web (Next.js Standalone)
# Security: Non-root execution (nextjs:nodejs, UID 1001)
# ==============================================================================

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
WORKDIR /app

# Stage 1: Install dependencies based on pnpm-lock.yaml
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/core/package.json ./packages/core/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/

RUN pnpm install --frozen-lockfile

# Stage 2: Build the source code
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps ./apps
COPY . .

ENV NODE_ENV=production
RUN pnpm --filter @hrms/config build && \
    pnpm --filter @hrms/shared build && \
    pnpm --filter @hrms/db build && \
    pnpm --filter @hrms/core build && \
    pnpm --filter @hrms/web build

# Stage 3: Production runner (minimal runtime, non-root)
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output and public assets
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
