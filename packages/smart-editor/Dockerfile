# syntax=docker/dockerfile:1
#
# Smart Editor — Verentis workspace application.
# Two-stage Nuxt build (SPA, ssr:false) served by the Nitro node server on port 80,
# mirroring the platform UI app images.

# ---- Build stage ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG NODE_BUILD_MAX_OLD_SPACE_SIZE=3072

# The package lock resolves @verentis/sdk from the registry, not a local workspace
# symlink. Use the same pinned dependency graph as the workspace build.
COPY package.json package-lock.json ./

RUN npm ci --no-audit --no-fund

# Copy the rest of the project and build. Keep an explicit heap ceiling so large Nuxt
# builds succeed without exhausting smaller Docker builders.
COPY . ./

# `npm ci` above fired the app's `postinstall: nuxt prepare` while only package.json
# was present, leaving a stale empty-project .nuxt. That breaks `defineProps<AliasedType>()`
# type resolution in `nuxt build` ("Failed to resolve import source ~/..."). Drop it so the
# build regenerates .nuxt from the full source.
RUN rm -rf .nuxt && NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_MAX_OLD_SPACE_SIZE}" npm run build

# ---- Runtime stage ----
FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=80

# Only `.output` is needed from the build stage.
COPY --from=build /app/.output/ ./

EXPOSE 80

CMD ["/app/server/index.mjs"]
