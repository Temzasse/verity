# Verity analysis server. Build from the repo root:
#   docker build -f server/Dockerfile .
FROM node:26-slim

WORKDIR /app
ENV NODE_ENV=production

# Only the server's runtime dependencies (the repo's package.json is the extension's).
RUN npm init -y >/dev/null \
  && npm pkg set type=module \
  && npm install --omit=dev --no-audit --no-fund @anthropic-ai/sdk@1.8.0 zod@4.6.7

# Node runs the TypeScript sources directly (type stripping).
COPY utils/analysis.ts utils/analysis.ts
COPY server/*.ts server/

ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
USER node
CMD ["node", "server/index.ts"]
