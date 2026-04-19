# =============================================================================
# Build context MUST be the repository root (the directory that contains
# `nakama/` and `deploy/`). Example:
#   docker build -f deploy/Dockerfile .
#
# If you see "deploy/entrypoint.sh: not found", your context is wrong (e.g.
# Render "Root Directory" set to a subfolder). Clear it so the repo root is used.
#
# TypeScript modules are compiled inside this image (no host `npm run build`).
# =============================================================================

FROM node:20-alpine AS nakama-modules
WORKDIR /build/nakama
COPY nakama/package.json nakama/package-lock.json ./
RUN npm ci
COPY nakama/ ./
RUN npm run build

FROM registry.heroiclabs.com/heroiclabs/nakama:3.22.0
COPY --from=nakama-modules /build/nakama/modules/build /nakama/data/modules/build
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 7350 7351 7349

ENTRYPOINT ["/entrypoint.sh"]
CMD []
