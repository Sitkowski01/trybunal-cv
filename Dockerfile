# Jedno budowanie calego monorepo, dwa obrazy wynikowe: api (Node) i web (nginx z frontendem).
FROM node:24-alpine AS build
RUN npm install --global pnpm@11.1.1
WORKDIR /app
# Najpierw sam lockfile: pobrane paczki zostaja w cache warstwy, dopoki nie zmienia sie zaleznosci.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN CI=true pnpm install --frozen-lockfile --offline
RUN pnpm --filter "@trybunal/api..." build && pnpm --filter @trybunal/web build
# Serwer z samymi zaleznosciami produkcyjnymi; pakiety workspace skopiowane do node_modules.
RUN pnpm --filter @trybunal/api deploy --prod --legacy /prod/api

FROM node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build /prod/api/package.json ./
COPY --from=build /prod/api/node_modules ./node_modules
COPY --from=build /prod/api/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM nginx:1.30-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
