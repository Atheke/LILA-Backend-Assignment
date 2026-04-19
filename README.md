# Multiplayer Tic-Tac-Toe (Nakama)

Production-ready backend-focused multiplayer Tic-Tac-Toe using Nakama with server-authoritative game logic.

## Tech Stack

- **Backend:** Nakama + Postgres
- **Runtime:** Nakama TypeScript modules compiled to JavaScript
- **Frontend:** React + Vite + Nakama JS client
- **Realtime transport:** Nakama sockets

## Project Structure

- `docker-compose.yml` - Local Nakama and Postgres containers
- `nakama/` - Runtime source and TypeScript build config
- `nakama/modules/index.ts` - Match registration entrypoint
- `nakama/modules/tic_tac_toe.ts` - Server-authoritative match handler
- `frontend/` - Web client
- `frontend/src/nakama.ts` - Nakama client helpers (auth, socket, matchmaking, move send)
- `frontend/src/App.tsx` - Multiplayer UI and realtime game rendering

## Architecture and Design Decisions

- All game logic runs on Nakama in `tic_tac_toe.ts`.
- Clients only send move intent (`index`) with opcode `1`.
- Server validates:
  - match capacity (2 players max)
  - turn ownership
  - valid board index
  - unoccupied cells
- Server computes turn changes and winner detection.
- Server broadcasts authoritative state using:
  - `TextEncoder` on backend
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

## Multiplayer Testing Guide

1. Open two browser windows (or one normal + one incognito).
2. In both windows click **Connect to Nakama**.
3. In window A click **Create Match**.
4. Copy match ID and use **Join Match** in window B, or use **Discover Open Matches**.
5. Click board cells to send moves.
6. Confirm:
   - turns switch correctly
   - invalid moves are ignored
   - state updates in both windows in real-time
   - winner/draw appears correctly

## Deployment Process Notes

- Backend deployment target: Nakama + Postgres on a cloud VM or managed container platform.
- Frontend deployment target: Vercel, Netlify, or equivalent static hosting.
- Build Nakama modules before backend deployment (`npm run build` in `nakama/`).
- Ensure deployed Nakama runtime path points to `/nakama/data/modules/build`.

## Server Configuration Details

- Server key: `defaultkey`
- Match handler name: `tic_tac_toe`
- Match data opcodes:
  - `1`: player move input (client -> server)
  - `2`: authoritative state update (server -> clients)
