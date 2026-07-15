# DigiWorld game node image — used by docker-compose.multinode.yml.
#
# Debian slim (not alpine) so argon2 + better-sqlite3 native builds match
# what upstream ships prebuilds for; alpine's musl would force a full source
# rebuild for better-sqlite3 on every image build.
FROM node:24-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH

RUN corepack enable

WORKDIR /app

# Install deps first for layer caching. pnpm-workspace.yaml holds the
# `allowBuilds` list for native modules.
COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml* ./
RUN pnpm install --prod=false --prefer-offline || pnpm install

# Copy the rest of the source (paths kept aligned with tsconfig).
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY data ./data

EXPOSE 3000

# tsx runs TS directly — no separate build step needed. For a smaller
# production image, `pnpm build && node dist/server.js` would work once the
# `dist/` artifact is compiled.
CMD ["./node_modules/.bin/tsx", "src/server.ts"]
