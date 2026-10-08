# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps
WORKDIR /app
# hots-parser depends on heroprotocol straight from GitHub.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* is inlined at build time. .env.local is dockerignored, so pass
# the browser secret as a build-arg (see docker compose --env-file .env.local).
ARG NEXT_PUBLIC_SCOUT_API_SECRET=
ENV NEXT_PUBLIC_SCOUT_API_SECRET=$NEXT_PUBLIC_SCOUT_API_SECRET
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV OCR_PYTHON=python3

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip gosu libgl1 libglib2.0-0 libgomp1 \
  && pip3 install --break-system-packages --no-cache-dir rapidocr-onnxruntime==1.2.3 pillow \
  && python3 -c "import rapidocr_onnxruntime" \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY scripts/ocr_names.py /app/scripts/ocr_names.py
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
