# syntax=docker/dockerfile:1

ARG NODE_VERSION=22.23.5
ARG PNPM_VERSION=12.21.0

FROM node:${NODE_VERSION}-bookworm-slim AS base

ARG PNPM_VERSION

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOME=/home/node

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@${PNPM_VERSION} \
    && npm cache clean --force

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pixora-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS builder

COPY . .

# 构建阶段只需要一个可解析的占位 URL，不会连接数据库。
ENV DATABASE_URL="postgresql://postgres:change_me@localhost:5432/ai_image_studio"
RUN pnpm prisma generate && pnpm build

# 迁移镜像只安装精确版本的 Prisma CLI，不携带应用依赖和源码。
FROM node:${NODE_VERSION}-bookworm-slim AS migrate

ENV NODE_ENV=production
ENV HOME=/home/node
WORKDIR /app

COPY package.json ./

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && PRISMA_VERSION="$(node -p 'require("./package.json").devDependencies.prisma')" \
    && npm install --global "prisma@${PRISMA_VERSION}" \
    && npm cache clean --force

COPY prisma ./prisma

USER node
CMD ["prisma", "migrate", "deploy"]

FROM node:${NODE_VERSION}-bookworm-slim AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV HOME=/home/node

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# standalone 已包含 web 运行时依赖；worker bundle 仅保留 Prisma 与 sharp 为外部依赖。
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/docker/worker-healthcheck.mjs ./docker/worker-healthcheck.mjs

USER node

# 在构建期验证镜像精简后仍可解析原生/数据库运行时依赖。
RUN DATABASE_URL="postgresql://postgres:change_me@localhost:5432/ai_image_studio" \
    node -e "require('sharp'); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); console.log('runtime dependencies ok'); void prisma.\$disconnect()"

EXPOSE 3000

CMD ["node", "server.js"]
