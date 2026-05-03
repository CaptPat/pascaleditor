# Multi-stage build for the Pascal Editor monorepo.
#
# Strategy:
#   - prune  : turbo prune carves out only the apps/editor subset and the
#              workspace packages it depends on, with their package.jsons
#              separated so deps install can be cached.
#   - deps   : install only the pruned package.jsons.
#   - builder: copy the pruned full source + cached node_modules, then
#              `bun run build` produces apps/editor/.next/standalone/
#              (Next.js standalone output enabled in next.config.ts).
#   - runtime: node:22-alpine, runs the standalone server. No bun, no
#              monorepo, no source — just the standalone bundle.
#
# Resulting image is ~150-250 MB depending on the standalone bundle size.

ARG BUN_VERSION=1.3
ARG NODE_VERSION=22

# ---------- prune stage: extract only what apps/editor needs ----------
FROM oven/bun:${BUN_VERSION}-alpine AS pruner
WORKDIR /repo
COPY . .
RUN bunx --bun turbo@2 prune editor --docker

# ---------- deps stage: install pruned package.jsons (cacheable) ----------
FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /repo
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/bun.lock ./bun.lock
# Note: --frozen-lockfile rejected because turbo prune does not perfectly
# trim bun.lock to match the pruned package.jsons (orphan entries remain
# for packages outside apps/editor's dependency closure). Allow bun to
# resolve from the pruned set instead. For a fork-deploy build pipeline,
# this trade-off is acceptable.
RUN bun install

# ---------- builder stage: full source + build ----------
FROM oven/bun:${BUN_VERSION}-alpine AS builder
WORKDIR /repo
COPY --from=deps /repo/ ./
COPY --from=pruner /repo/out/full/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# ---------- runtime stage: minimal Node image with the standalone bundle ----------
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
ENV HOSTNAME=0.0.0.0

# Standalone output is rooted at the monorepo root (outputFileTracingRoot
# in next.config.ts), so server.js lives at apps/editor/server.js with
# its own minimal node_modules co-located.
COPY --from=builder /repo/apps/editor/.next/standalone/ ./
COPY --from=builder /repo/apps/editor/.next/static/ ./apps/editor/.next/static/
COPY --from=builder /repo/apps/editor/public/ ./apps/editor/public/

# Run as non-root for defense-in-depth.
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3002
CMD ["node", "apps/editor/server.js"]
