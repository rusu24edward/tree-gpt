# Next.js app
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
# Use BuildKit cache to speed up installs across rebuilds
RUN --mount=type=cache,target=/root/.npm npm install --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Ensure public exists even if empty in source
RUN mkdir -p public
# Persist Next.js build cache between builds for faster increments
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "start"]
