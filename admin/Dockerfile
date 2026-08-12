FROM node:24-alpine AS build

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY scene3d/package.json ./scene3d/
COPY admin/package.json ./admin/
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
COPY discord/package.json ./discord/

# Install only what the admin + shared build needs.
RUN pnpm install --frozen-lockfile --filter @digiworld/shared... --filter @digiworld/admin...

COPY shared ./shared/
COPY scene3d ./scene3d/
COPY admin ./admin/

RUN pnpm --filter @digiworld/shared build \
 && pnpm --filter @digiworld/admin build

FROM nginx:1.27-alpine AS runtime

COPY deploy/admin-nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/admin/dist /usr/share/nginx/html

RUN chown -R nginx:nginx /var/cache/nginx /var/log/nginx /etc/nginx /usr/share/nginx/html \
 && touch /var/run/nginx.pid \
 && chown nginx:nginx /var/run/nginx.pid \
 && sed -i 's/listen 80/listen 8080/' /etc/nginx/nginx.conf

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
