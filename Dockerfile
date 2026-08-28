FROM node:24.15.0-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d

ENV NODE_ENV=production

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node src ./src

USER node

EXPOSE 8080

CMD ["node", "--import", "tsx", "server/start.ts"]
