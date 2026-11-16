# Ferry Solver Daemon Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/chain-config/package.json ./packages/chain-config/
COPY packages/chain-evm/package.json ./packages/chain-evm/
COPY packages/htlc-bch/package.json ./packages/htlc-bch/
COPY packages/htlc-evm/package.json ./packages/htlc-evm/
COPY packages/bch-prices/package.json ./packages/bch-prices/
COPY packages/solver-client/package.json ./packages/solver-client/
COPY packages/solver/package.json ./packages/solver/

RUN pnpm install --frozen-lockfile

COPY packages/core ./packages/core
COPY packages/chain-config ./packages/chain-config
COPY packages/chain-evm ./packages/chain-evm
COPY packages/htlc-bch ./packages/htlc-bch
COPY packages/htlc-evm ./packages/htlc-evm
COPY packages/bch-prices ./packages/bch-prices
COPY packages/solver-client ./packages/solver-client
COPY packages/solver ./packages/solver

RUN pnpm --filter @ferry/solver build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

RUN mkdir -p /app/data /app/logs

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core ./packages/core
COPY --from=builder /app/packages/chain-config ./packages/chain-config
COPY --from=builder /app/packages/chain-evm ./packages/chain-evm
COPY --from=builder /app/packages/htlc-bch ./packages/htlc-bch
COPY --from=builder /app/packages/htlc-evm ./packages/htlc-evm
COPY --from=builder /app/packages/bch-prices ./packages/bch-prices
COPY --from=builder /app/packages/solver/dist ./packages/solver/dist
COPY --from=builder /app/packages/solver/package.json ./packages/solver/

EXPOSE 8787

VOLUME ["/app/data", "/app/logs"]

CMD ["node", "packages/solver/dist/main.js"]
