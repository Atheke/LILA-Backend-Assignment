#!/bin/sh
set -eu

# Resolves Nakama --database.address value (no postgres:// prefix; Nakama adds it).
# Priority: NAKAMA_DATABASE_ADDRESS > DATABASE_URL > DB_* discrete variables.

if [ -n "${NAKAMA_DATABASE_ADDRESS:-}" ]; then
  DB_ADDR="$NAKAMA_DATABASE_ADDRESS"
elif [ -n "${DATABASE_URL:-}" ]; then
  DB_ADDR="$DATABASE_URL"
  DB_ADDR="${DB_ADDR#postgresql://}"
  DB_ADDR="${DB_ADDR#postgres://}"
elif [ -n "${DB_HOST:-}" ] && [ -n "${DB_USER:-}" ] && [ -n "${DB_NAME:-}" ]; then
  DB_PORT="${DB_PORT:-5432}"
  DB_PASS="${DB_PASS:-}"
  DB_ADDR="${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  if [ -n "${DB_SSLMODE:-}" ]; then
    DB_ADDR="${DB_ADDR}?sslmode=${DB_SSLMODE}"
  fi
else
  echo "Missing database configuration. Set one of:" >&2
  echo "  - DATABASE_URL (e.g. from Render/Railway Postgres), or" >&2
  echo "  - NAKAMA_DATABASE_ADDRESS (user:pass@host:port/dbname[?query]), or" >&2
  echo "  - DB_USER, DB_PASS, DB_HOST, DB_NAME (optional DB_PORT, DB_SSLMODE)." >&2
  exit 1
fi

RUNTIME_PATH="${NAKAMA_RUNTIME_PATH:-/nakama/data/modules/build}"
SOCKET_PORT="${NAKAMA_SOCKET_PORT:-${PORT:-7350}}"

/nakama/nakama migrate up --database.address "$DB_ADDR"

exec /nakama/nakama \
  --name "${NAKAMA_NODE_NAME:-nakama1}" \
  --database.address "$DB_ADDR" \
  --logger.level "${NAKAMA_LOGGER_LEVEL:-INFO}" \
  --runtime.path "$RUNTIME_PATH" \
  --socket.port "$SOCKET_PORT" \
  --session.token_expiry_sec "${NAKAMA_SESSION_TOKEN_EXPIRY_SEC:-7200}" \
  --socket.server_key "${NAKAMA_SOCKET_SERVER_KEY:-defaultkey}" \
  --session.encryption_key "${NAKAMA_SESSION_ENCRYPTION_KEY:-defaultencryptionkey}" \
  --session.refresh_encryption_key "${NAKAMA_SESSION_REFRESH_ENCRYPTION_KEY:-defaultrefreshencryptionkey}" \
  --runtime.http_key "${NAKAMA_RUNTIME_HTTP_KEY:-defaulthttpkey}" \
  --console.username "${NAKAMA_CONSOLE_USERNAME:-admin}" \
  --console.password "${NAKAMA_CONSOLE_PASSWORD:-password}" \
  "$@"
