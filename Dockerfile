# better-sqlite3 compiles a native addon at install time; the compiled
# binding is tied to the platform/arch/libc it was built on. Everything from
# `deps` onward runs in this image, on the target arch, so the addon that
# ends up in `runner` is the one that actually matches the runtime - never
# copy a host node_modules in instead (see KAD-6).

FROM node:22-bookworm-slim AS base
RUN corepack enable

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/phash/package.json packages/phash/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

# Runtime image has no compiler - just the already-built app and the
# already-compiled native addon carried over from `builder`.
FROM base AS runner
WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_PATH=/data/mtg.db
# pnpm workspace packages are symlinked, not copied: apps/web/node_modules/*
# and packages/*/node_modules/* resolve into the *root* node_modules/.pnpm
# store, and @mtg/schemas resolves from apps/web/node_modules straight into
# ../../packages/schemas. All three copies must land at the same relative
# paths as the builder stage for those symlinks to still resolve.
COPY --from=builder /app/node_modules ../../node_modules
COPY --from=builder /app/packages ../../packages
COPY --from=builder /app/apps/web ./

EXPOSE 3000
CMD ["sh", "-c", "node --experimental-strip-types src/server/db/migrate.ts && node_modules/.bin/next start -p 3000"]
