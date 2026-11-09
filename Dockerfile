FROM node:26.13.0-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS dependencies

ENV NODE_ENV=production

WORKDIR /app

RUN npm install --global pnpm@10.33.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY container/online/package.json ./container/online/package.json
COPY patches ./patches
RUN pnpm --filter @four-bros-mahjong/online-runtime --fail-if-no-match install --prod --frozen-lockfile \
    && pnpm --filter @four-bros-mahjong/online-runtime --fail-if-no-match deploy --prod /runtime

FROM node:26.13.0-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072

ENV NODE_ENV=production

WORKDIR /app

COPY --from=dependencies /runtime/node_modules ./node_modules
COPY --from=dependencies /runtime/package.json ./package.json
COPY tsconfig.json ./
COPY server ./server
COPY src ./src

USER node

EXPOSE 8080

CMD ["node", "--import", "tsx", "server/start.ts"]
