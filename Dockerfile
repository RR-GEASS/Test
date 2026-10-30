FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=secret,id=npm_ca if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; npm ci --no-audit --no-fund --fetch-retries=0 --fetch-timeout=30000
COPY . .
RUN npm run build && npm test

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 SCI_DATA_DIR=/app/data
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=secret,id=npm_ca if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; npm ci --omit=dev --no-audit --no-fund --fetch-retries=0 --fetch-timeout=30000 && npm cache clean --force && mkdir -p /app/data /app/backups && chown node:node /app/data /app/backups
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node src/*.js ./src/
COPY --chown=node:node scripts/*.mjs ./scripts/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "--input-type=module", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server/index.js"]
