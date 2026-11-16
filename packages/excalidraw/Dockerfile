# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor/ ./vendor/
RUN npm install --global npm@11.12.1 --no-audit --no-fund \
    && npm ci --no-audit --no-fund
COPY . .
RUN rm -rf .nuxt && NODE_OPTIONS=--max-old-space-size=3072 npm run build

FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY --from=build /app/.output/ ./
EXPOSE 8080
CMD ["/app/server/index.mjs"]
