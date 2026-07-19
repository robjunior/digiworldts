FROM node:24-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN pnpm install --frozen-lockfile --filter @digiworld/shared... --filter @digiworld/backend...

COPY shared ./shared/
COPY backend ./backend/

RUN pnpm --filter @digiworld/shared build \
 && pnpm --filter @digiworld/backend build

# Drop root: the `node` user ships with node:24-slim (uid 1000). Any file-write
# primitive (e.g. from the catalog verifier or shop payload) now lands as a
# non-root uid, limiting blast radius. Data/asset volumes must be writable by
# uid 1000 — the compose file's named volumes are created empty and owned by
# whichever container first writes, so this works out of the box.
RUN mkdir -p /app/backend/data /app/backend/data/cache /app/backend/public/assets/digimon \
 && chown -R node:node /app

USER node

WORKDIR /app/backend

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/server.js"]
