# Watcher image: builds the CLI from source into one file and runs `on-the-clock watch`.
#   docker build -f docker/watcher.Dockerfile -t on-the-clock-watcher .
#   docker run -e WATCHER_PRIVATE_KEY=0x... -e WATCHER_OPERATOR=me -p 8080:8080 on-the-clock-watcher
FROM node:24-alpine AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/cli/package.json apps/cli/
RUN pnpm install --frozen-lockfile --filter on-the-clock... --filter on-the-clock-sdk...
COPY packages/sdk packages/sdk
COPY apps/cli apps/cli
RUN pnpm --filter on-the-clock-sdk run build:js && pnpm --filter on-the-clock run bundle

FROM node:24-alpine
WORKDIR /app
COPY --from=build /src/apps/cli/bundle/watcher.js ./watcher.js
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "watcher.js", "watch"]
