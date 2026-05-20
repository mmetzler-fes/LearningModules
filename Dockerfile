# ---- Build stage ----
FROM oven/bun:1 AS builder

WORKDIR /app

# Build tools required for native addon (sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install all dependencies (including devDeps for @nestjs/cli / nest build)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and compile TypeScript
COPY . .
RUN bun run build


# ---- Production stage ----
FROM node:22-slim AS runner

WORKDIR /app

# Build tools required for native addon (sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install only production dependencies
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts=false

# Copy compiled NestJS app
COPY --from=builder /app/dist ./dist

# Copy static frontend (served at runtime via ServeStaticModule from src/renderer)
COPY src/renderer ./src/renderer

# SQLite data directory (mounted as volume)
RUN mkdir -p data

EXPOSE 3000

CMD ["node", "dist/main"]
