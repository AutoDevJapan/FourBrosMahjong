FROM node:26.12.1-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS dependencies

ENV NODE_ENV=production

WORKDIR /app

RUN npm install --global pnpm@10.33.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY container/online/package.json ./container/online/package.json
RUN pnpm --filter @four-bros-mahjong/online-runtime --fail-if-no-match install --prod --frozen-lockfile \
    && pnpm --filter @four-bros-mahjong/online-runtime --fail-if-no-match deploy --prod /runtime

FROM node:26.12.1-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec

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
