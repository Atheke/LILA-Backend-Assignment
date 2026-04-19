# Nakama deployment (Docker)

Production-oriented image and entrypoint: database settings come only from environment variables (no credentials in the repo).

## Build

From the **repository root** (so paths `nakama/` and `deploy/` exist in the build context):

```bash
docker build -f deploy/Dockerfile -t nakama-ttt .
```

The image runs `npm ci` and `npm run build` in `nakama/` during the build; you do not need a separate host build step. On Render, leave **Root Directory** empty so the context is the repo root; otherwise `COPY deploy/entrypoint.sh` fails.

## Startup command

The container runs `deploy/entrypoint.sh`, which:

1. Resolves the database DSN (see below).
2. Runs `nakama migrate up --database.address …`.
3. `exec`s `nakama` with the same `--database.address`, runtime path, and security-related flags from the environment.

This matches the pattern used locally in `docker-compose.yml` (migrate then server), without hardcoded passwords.

## Database environment (choose one)

### Option A — `DATABASE_URL` (Render / Railway default)

Managed Postgres usually injects `DATABASE_URL`, for example:

`postgresql://user:pass@host:5432/dbname?sslmode=require`

The entrypoint strips the `postgres://` or `postgresql://` prefix and passes the remainder to Nakama’s `--database.address` (Nakama prepends the Postgres scheme internally).

**Set externally:** `DATABASE_URL` (provided by the platform when you attach Postgres).

### Option B — `NAKAMA_DATABASE_ADDRESS`

Set the full Nakama fragment yourself (no `postgres://` prefix), same form as the flag docs:

`username:password@host:port/dbname`  
Optional query string, e.g. `?sslmode=require`, is appended by you if needed.

**Set externally:** `NAKAMA_DATABASE_ADDRESS`.

### Option C — discrete `DB_*` variables

| Variable    | Required | Default | Description                          |
|------------|----------|---------|--------------------------------------|
| `DB_USER`  | yes      | —       | Postgres user                        |
| `DB_PASS`  | no       | empty   | Password (avoid special shell chars or use `DATABASE_URL`) |
| `DB_HOST`  | yes      | —       | Hostname                             |
| `DB_NAME`  | yes      | —       | Database name                        |
| `DB_PORT`  | no       | `5432`  | Port                                 |
| `DB_SSLMODE` | no     | —       | If set, appends `?sslmode=…`       |

**Set externally:** `DB_USER`, `DB_HOST`, `DB_NAME`, and usually `DB_PASS`; optional `DB_PORT`, `DB_SSLMODE`.

Priority order: `NAKAMA_DATABASE_ADDRESS` → `DATABASE_URL` → `DB_*` composite.

## Other environment variables (set externally in production)

| Variable | Purpose |
|----------|---------|
| `PORT` | Some hosts (e.g. Railway) set the HTTP port the router expects. The entrypoint maps this to `--socket.port` when `NAKAMA_SOCKET_PORT` is unset. Your frontend `VITE_NAKAMA_PORT` must match the public port clients use. |
| `NAKAMA_SOCKET_PORT` | Overrides `PORT` for the API/WebSocket listener (defaults to `7350` if `PORT` is unset). |
| `NAKAMA_RUNTIME_PATH` | Directory with compiled JS modules (default `/nakama/data/modules/build` in the image). |
| `NAKAMA_NODE_NAME` | Cluster node name (default `nakama1`). |
| `NAKAMA_LOGGER_LEVEL` | e.g. `INFO`, `DEBUG`. |
| `NAKAMA_SESSION_TOKEN_EXPIRY_SEC` | Session lifetime (default `7200`). |
| `NAKAMA_SOCKET_SERVER_KEY` | Client server key; **must match** `VITE_NAKAMA_SERVER_KEY` on the web app. |
| `NAKAMA_SESSION_ENCRYPTION_KEY` | Replace defaults before production. |
| `NAKAMA_SESSION_REFRESH_ENCRYPTION_KEY` | Replace defaults before production. |
| `NAKAMA_RUNTIME_HTTP_KEY` | Protects runtime HTTP hooks; replace default. |
| `NAKAMA_CONSOLE_USERNAME` / `NAKAMA_CONSOLE_PASSWORD` | Console login; change password in production. |

Render/Railway do **not** set the Nakama security keys or console password for you: define those in the service’s environment UI (or your secrets manager) and mirror `NAKAMA_SOCKET_SERVER_KEY` in the frontend build env.

## Platform notes

### Render

- Use `deploy/render.yaml` as a blueprint or copy the `DATABASE_URL` wiring pattern.
- The Web service must reach Postgres over the network Render provides; `fromDatabase.connectionString` supplies `DATABASE_URL`.
- Health check uses `GET /healthcheck` on the API port. If your plan only exposes one public port, align `NAKAMA_SOCKET_PORT` / `PORT` with that and point the health check at the same port.

### Railway

- `railway.toml` builds from `deploy/Dockerfile`.
- Add a Postgres plugin and ensure `DATABASE_URL` is available to the Nakama service (Railway does this by default when linked).
- If Railway sets `PORT`, the entrypoint binds the API socket to that value unless you override with `NAKAMA_SOCKET_PORT`.

## Multi-port caveat

Nakama listens on API (`--socket.port`, default 7350), console (`7351` by default), and gRPC (`7349`). Some PaaS offerings only publish one external port; you may need their TCP/proxy features, a sidecar, or a host that supports multiple ports. For a single published port, set `NAKAMA_SOCKET_PORT`/`PORT` to that port and accept that the console may not be reachable externally unless you add a separate service or tunnel.
