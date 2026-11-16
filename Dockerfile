FROM node:26.13.1-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS dependencies

ENV NODE_ENV=production

WORKDIR /app

RUN npm install --global pnpm@10.33.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY container/online/package.json ./container/online/package.json
COPY patches ./patches
RUN pnpm --filter @four-bros-mahjong/online-runtime --fail-if-no-match install --prod --frozen-lockfile \
    && pnpm --filter @four-bros-mahjong/online-runtime --fail-if-no-match deploy --prod /runtime

FROM node:26.13.1-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc

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
