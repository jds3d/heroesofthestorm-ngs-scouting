# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
# hots-parser depends on heroprotocol straight from GitHub.
RUN apk add --no-cache git
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* is inlined at build time. .env.local is dockerignored, so pass
# the browser secret as a build-arg (see docker compose --env-file .env.local).
ARG NEXT_PUBLIC_SCOUT_API_SECRET=
ENV NEXT_PUBLIC_SCOUT_API_SECRET=$NEXT_PUBLIC_SCOUT_API_SECRET
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && apk add --no-cache su-exec

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
