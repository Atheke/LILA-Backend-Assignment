# Build Nakama modules first: (repo root) cd nakama && npm ci && npm run build
FROM registry.heroiclabs.com/heroiclabs/nakama:3.22.0

COPY nakama/modules/build /nakama/data/modules/build
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 7350 7351 7349

ENTRYPOINT ["/entrypoint.sh"]
CMD []
