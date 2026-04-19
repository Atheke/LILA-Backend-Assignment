import { Client, LeaderboardRecord, Session, Socket } from "@heroiclabs/nakama-js";
import { getNakamaPublicConfig } from "./env";

export const TIC_TAC_TOE_LEADERBOARD_ID = "tic_tac_toe_ranking";

export type GameMode = "classic" | "timed";

const DEVICE_STORAGE_KEY = "ttt-device-id";

export function formatNakamaClientError(err: unknown): string {
  if (typeof err === "string") {
    return err;
  }
  if (err instanceof Error) {
    return err.message;
  }
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") {
      const code = (err as { code?: unknown }).code;
      return typeof code === "number" ? `${m} (code ${String(code)})` : m;
    }
  }
  if (typeof Response !== "undefined" && err instanceof Response) {
    return `HTTP ${String(err.status)}`;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

const { serverKey, host, port, useSSL } = getNakamaPublicConfig();
const client = new Client(serverKey, host, port, useSSL);

let session: Session | null = null;
let socket: Socket | null = null;

function migrateLegacyDeviceId(): void {
  try {
    const fromSession = sessionStorage.getItem(DEVICE_STORAGE_KEY);
    if (fromSession && !localStorage.getItem(DEVICE_STORAGE_KEY)) {
      localStorage.setItem(DEVICE_STORAGE_KEY, fromSession);
      sessionStorage.removeItem(DEVICE_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

function getOrCreateDeviceId(): string {
  migrateLegacyDeviceId();
  const existing = localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_STORAGE_KEY, id);
  return id;
}

async function requireSession(): Promise<Session> {
  if (session && !session.isexpired(Date.now() / 1000)) {
    return session;
  }
  throw new Error("Not authenticated. Choose a username first.");
}

/** Stable device id + chosen username; persists stats on the same browser. */
export async function authenticateWithUsername(username: string): Promise<Session> {
  const trimmed = username.trim();
  if (trimmed.length < 2 || trimmed.length > 16) {
    throw new Error("Username must be 2–16 characters.");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error("Username may only contain letters, numbers, underscore, and hyphen.");
  }

  const deviceId = getOrCreateDeviceId();

  if (socket) {
    try {
      socket.disconnect(true);
    } catch {
      /* ignore */
    }
    socket = null;
  }

  session = await client.authenticateDevice(deviceId, true, trimmed);
  return session;
}

export async function createSocket(): Promise<Socket> {
  if (socket) {
    return socket;
  }

  const activeSession = await requireSession();
  socket = client.createSocket(useSSL, false);
  await socket.connect(activeSession, true);
  return socket;
}

export async function getCurrentUserId(): Promise<string> {
  const activeSession = await requireSession();
  return activeSession.user_id ?? activeSession.username ?? "";
}

export async function createMatch(mode: GameMode = "classic"): Promise<string> {
  const activeSession = await requireSession();
  const cfg = getNakamaPublicConfig();
  const scheme = cfg.useSSL ? "https://" : "http://";
  const rpcUrl = `${scheme}${cfg.host}:${cfg.port}/v2/rpc/${encodeURIComponent("create_tic_tac_toe_match")}?`;
  const rpcPayload = JSON.stringify({ mode });
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${activeSession.token}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(rpcPayload)
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      detail = parsed.message || parsed.error || text;
    } catch {
      /* keep raw text */
    }
    throw new Error(`create_tic_tac_toe_match failed (${String(res.status)}): ${detail}`);
  }
  const envelope = JSON.parse(text) as { payload?: string };
  const raw = envelope.payload;
  if (!raw) {
    throw new Error("Nakama RPC did not return a payload.");
  }
  const parsed = JSON.parse(raw) as { matchId?: string };
  if (!parsed.matchId) {
    throw new Error("Nakama RPC did not return a match ID.");
  }
  return parsed.matchId;
}

export async function joinMatch(matchId: string) {
  const activeSocket = await createSocket();
  return activeSocket.joinMatch(matchId);
}

export async function sendMove(matchId: string, index: number): Promise<void> {
  const activeSocket = await createSocket();
  await activeSocket.sendMatchState(matchId, 1, JSON.stringify({ index }));
}

export async function sendRestart(matchId: string): Promise<void> {
  const activeSocket = await createSocket();
  await activeSocket.sendMatchState(matchId, 3, "{}");
}

export async function leaveMatch(matchId: string): Promise<void> {
  const activeSocket = await createSocket();
  await activeSocket.leaveMatch(matchId);
}

function labelQueryForMode(mode: GameMode): string {
  return `+label.game:tic_tac_toe +label.mode:${mode}`;
}

export async function listMatches(limit = 20, mode: GameMode = "classic") {
  const activeSession = await requireSession();
  return client.listMatches(activeSession, limit, true, "", 0, 2, labelQueryForMode(mode));
}

export async function fetchTopLeaderboardRecords(limit = 15): Promise<LeaderboardRecord[]> {
  const activeSession = await requireSession();
  const list = await client.listLeaderboardRecords(activeSession, TIC_TAC_TOE_LEADERBOARD_ID, undefined, limit);
  return list.records ?? [];
}

export async function fetchMyLeaderboardRecord(): Promise<LeaderboardRecord | null> {
  const activeSession = await requireSession();
  const uid = activeSession.user_id;
  if (!uid) {
    return null;
  }
  const list = await client.listLeaderboardRecords(activeSession, TIC_TAC_TOE_LEADERBOARD_ID, [uid], 1);
  const mine = list.owner_records?.[0] ?? list.records?.find((r) => r.owner_id === uid);
  return mine ?? null;
}
