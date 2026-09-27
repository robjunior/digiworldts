FROM node:24-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH

RUN corepack enable \
 && corepack prepare pnpm@10.34.5 --activate

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
# non-root uid, limiting blast radius. Every named volume in docker-compose.yml
# must have its mount target pre-created here and chowned to node — Docker seeds
# an empty named volume with the mount target's ownership + permissions on FIRST
# mount, so a missing mkdir means Docker synthesizes the path as root:root and
# every write from the running backend fails with EACCES. Volumes: assetdata
# (public/assets/digimon), scrapecache (data/cache), scenedata (data/scenes),
# tilesetdata (data/tilesets).
RUN mkdir -p /app/backend/data /app/backend/data/cache /app/backend/data/scenes /app/backend/data/tilesets /app/backend/public/assets/digimon \
 && chown -R node:node /app

USER node

WORKDIR /app/backend

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/server.js"]
