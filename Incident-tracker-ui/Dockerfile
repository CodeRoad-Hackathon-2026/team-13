# ---------------------------------------------------------------- build
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json* .npmrc ./
RUN npm ci --no-audit --no-fund

COPY . .
# MSW must not start in the built bundle: it is a development fixture layer, and
# its service worker would answer requests the real API should serve.
ENV VITE_USE_API=true
RUN npm run build


# -------------------------------------------------------------- runtime
FROM nginx:1.27-alpine

# The SPA is served from the same origin as /api, which is why src/api/client.ts
# can use relative paths and needs no base-URL configuration at all.
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
