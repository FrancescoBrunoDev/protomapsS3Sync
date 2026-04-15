FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun build --target=bun --outdir=dist src/server.ts

FROM oven/bun:1-alpine

WORKDIR /app

RUN apk add --no-cache rclone

COPY package.json bun.lockb* ./
RUN bun install --production --frozen-lockfile

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", "run", "dist/server.js"]
