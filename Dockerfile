FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS build
COPY apps/runtime ./apps/runtime
RUN node apps/runtime/scripts/build.mjs

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV SYNTAX_SENPAI_DATA_DIR=/data
ENV SYNTAX_SENPAI_PLUGIN_DIR=/app/plugins
ENV SYNTAX_SENPAI_BACKUP_DIR=/data/backups

COPY --from=build /app/apps/runtime/dist ./apps/runtime/dist
COPY apps/runtime/package.json ./apps/runtime/package.json
COPY plugins ./plugins

RUN addgroup -S syntaxsenpai && adduser -S syntaxsenpai -G syntaxsenpai \
  && mkdir -p /data \
  && chown -R syntaxsenpai:syntaxsenpai /app /data

USER syntaxsenpai
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/healthz >/dev/null || exit 1

CMD ["node", "apps/runtime/dist/server.js"]
