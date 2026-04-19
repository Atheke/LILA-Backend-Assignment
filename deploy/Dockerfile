# =============================================================================
# Build context: repository root (directory containing `nakama/`).
#   docker build -f deploy/Dockerfile .
#
# The entrypoint is copied from the build stage (under nakama/) so the final
# image does not depend on deploy/entrypoint.sh existing in the host context
# (fixes Render/CI setups where only part of the tree is visible).
#
# TypeScript modules are compiled in the first stage (npm run build).
# =============================================================================

FROM node:20-alpine AS nakama-modules
WORKDIR /build/nakama
COPY nakama/package.json nakama/package-lock.json ./
RUN npm ci
COPY nakama/ ./
RUN npm run build

FROM registry.heroiclabs.com/heroiclabs/nakama:3.22.0
COPY --from=nakama-modules /build/nakama/modules/build /nakama/data/modules/build
COPY --from=nakama-modules /build/nakama/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 7350 7351 7349

ENTRYPOINT ["/entrypoint.sh"]
CMD []
