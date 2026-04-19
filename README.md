# Multiplayer Tic-Tac-Toe (Nakama)

Multiplayer Tic-Tac-Toe with Nakama (server-authoritative match) and a React client.

## Tech Stack

- **Backend:** Nakama + Postgres
- **Runtime:** Nakama TypeScript modules compiled to JavaScript
- **Frontend:** React + Vite + Nakama JS client
- **Realtime transport:** Nakama sockets

## Project Structure

- `docker-compose.yml` - Local Nakama and Postgres containers
- `deploy/` - Production Docker image and Render/Railway hints (`deploy/README.md`); entrypoint script lives in `nakama/docker-entrypoint.sh`
- `nakama/` - Runtime source and TypeScript build config
- `nakama/modules/index.ts` - Nakama JS entrypoint only: match logic, `create_tic_tac_toe_match` RPC, and `InitModule` (compiled to `index.js`; Nakama does not load other `.js` files as entrypoints)
- `frontend/` - Web client
- `frontend/src/env.ts` - Reads public Nakama settings from `VITE_*` env vars
- `frontend/src/nakama.ts` - Nakama client (device auth, socket, RPC, match messages)
- `frontend/src/App.tsx` - UI
- `frontend/.env.example` - Template for production builds
- `frontend/.env.development` - Defaults for local `npm run dev` against Docker Nakama

## Architecture and Design Decisions

- All game rules and `InitModule` live in `index.ts` because Nakama’s JavaScript runtime [loads only `index.js`](https://github.com/heroiclabs/nakama/blob/master/server/runtime_javascript.go) from the module path.
- The web client connects to Nakama automatically on load (no manual “connect” step).
- Clients send move intent (`index`) with opcode `1`, and restart requests with opcode `3`.
- Server validates:
  - match capacity (2 players max)
  - turn ownership
  - valid board index
  - unoccupied cells
- Server computes turn changes and winner detection.
- Server broadcasts authoritative state using:
  - `TextEncoder` on backend (with a small fallback when `TextEncoder` is unavailable in the JS runtime)
  - `dispatcher.broadcastMessage(2, Uint8ArrayPayload)`
- Frontend decodes state updates using `TextDecoder` from `socket.onmatchdata`.

## Setup and Installation

### Prerequisites

- Docker + Docker Compose
- Node.js 20+ and npm

### 1) Build Nakama runtime modules

```bash
cd nakama
npm install
npm run build
```

### 2) Start Nakama + Postgres

```bash
cd ..
docker-compose up --build
```

Nakama endpoints:
- HTTP API: `http://127.0.0.1:7350`
- Console: `http://127.0.0.1:7351`
- Realtime socket: `ws://127.0.0.1:7350/ws`

### 3) Start frontend

```bash
cd frontend
npm install
npm run dev
```

Vite default URL: `http://127.0.0.1:5173`

Local dev loads `frontend/.env.development`. For a production bundle, set `VITE_NAKAMA_HOST`, `VITE_NAKAMA_PORT`, `VITE_NAKAMA_SERVER_KEY`, and `VITE_NAKAMA_USE_SSL` (`true` or `false`) in the build environment or in an untracked `frontend/.env.production` copied from `frontend/.env.example`. `npm run build` fails if any of these are missing.

## Multiplayer Testing Guide

1. Open two browser windows (or one normal + one incognito). Each tab loads the app and connects to Nakama on its own.
2. In window A click **Create Match**.
3. Copy match ID and use **Join Match** in window B, or use **Discover Open Matches**.
4. Click board cells to send moves.
5. Confirm:
   - turns switch correctly
   - invalid moves are ignored
   - state updates in both windows in real-time
   - winner/draw appears correctly
   - Restart / Restart Round syncs a new game via opcode `3`

## Deployment Process Notes

- Backend: Nakama + Postgres (VM, Kubernetes, or managed containers).
- Frontend: static hosting; configure the same four `VITE_NAKAMA_*` variables in the host’s build settings so the client points at your Nakama HTTP/WebSocket endpoint.
- Run `npm run build` in `nakama/` before deploying the game server.
- Point the Nakama container’s module path at the built JS (see `docker-compose.yml`).

## Server Configuration Details

- Server key: `defaultkey`
- Match handler name: `tic_tac_toe`
- Match data opcodes:
  - `1`: player move input (client → server)
  - `2`: authoritative state update (server → clients)
  - `3`: restart request when both players are present (client → server); server resets board and turn
