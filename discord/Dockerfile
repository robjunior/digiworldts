FROM node:24-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH

RUN corepack enable \
 && corepack prepare pnpm@10.34.5 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY discord/package.json ./discord/

RUN pnpm install --frozen-lockfile --filter @digiworld/discord...

COPY discord ./discord/

RUN pnpm --filter @digiworld/discord build \
 && chown -R node:node /app

USER node

WORKDIR /app/discord

EXPOSE 3100

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
