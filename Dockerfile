FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config.yml ./config.yml
COPY --from=builder /app/assets ./assets
# Templates are bundled in dist via default-templates.ts
EXPOSE 8080 1965 70 300 1900 79 5011
USER node
ENTRYPOINT ["node", "dist/bin.js"]
CMD ["serve"]
