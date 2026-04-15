FROM oven/bun:1-alpine

WORKDIR /app

RUN apk add --no-cache rclone

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production

CMD ["bun", "run", "updateMap"]
