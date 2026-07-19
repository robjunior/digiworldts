FROM node:24-alpine AS build

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

RUN pnpm install --frozen-lockfile --filter @digiworld/shared... --filter @digiworld/frontend...

COPY shared ./shared/
COPY frontend ./frontend/

RUN pnpm --filter @digiworld/shared build \
 && pnpm --filter @digiworld/frontend build

FROM nginx:1.27-alpine AS runtime

COPY deploy/frontend-nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

RUN chown -R nginx:nginx /var/cache/nginx /var/log/nginx /etc/nginx /usr/share/nginx/html \
 && touch /var/run/nginx.pid \
 && chown nginx:nginx /var/run/nginx.pid \
 && sed -i 's/listen 80/listen 8080/' /etc/nginx/nginx.conf

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
