FROM node:26.12.0-slim@sha256:0d1e33586362bb9e608c4e751e7a9e7edb55c9ac11461ed5666af696cc461dd4 AS dependencies

ENV NODE_ENV=production

WORKDIR /app

RUN npm install --global pnpm@10.33.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY container/online/package.json ./container/online/package.json
RUN pnpm --filter @four-bros-mahjong/online-runtime --fail-if-no-match install --prod --frozen-lockfile \
    && pnpm --filter @four-bros-mahjong/online-runtime --fail-if-no-match deploy --prod /runtime

FROM node:26.12.0-slim@sha256:0d1e33586362bb9e608c4e751e7a9e7edb55c9ac11461ed5666af696cc461dd4

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
