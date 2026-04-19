import { Client, Session, Socket } from "@heroiclabs/nakama-js";
import { getNakamaPublicConfig } from "./env";

const { serverKey, host, port, useSSL } = getNakamaPublicConfig();
const client = new Client(serverKey, host, port, useSSL);

let session: Session | null = null;
let socket: Socket | null = null;

export async function authenticateDevice(): Promise<Session> {
  if (session && !session.isexpired(Date.now() / 1000)) {
    return session;
  }

  const storageKey = "ttt-device-id";
  const existingDeviceId = sessionStorage.getItem(storageKey);
  const deviceId = existingDeviceId ?? crypto.randomUUID();
  sessionStorage.setItem(storageKey, deviceId);

  session = await client.authenticateDevice(deviceId, true);
  return session;
}

export async function createSocket(): Promise<Socket> {
  if (socket) {
    return socket;
  }

  const activeSession = await authenticateDevice();
  socket = client.createSocket(useSSL, false);
  await socket.connect(activeSession, true);
  return socket;
}

export async function getCurrentUserId(): Promise<string> {
  const activeSession = await authenticateDevice();
  return activeSession.user_id ?? activeSession.username ?? "";
}

export async function createMatch(): Promise<string> {
  const activeSocket = await createSocket();
  const result = await activeSocket.rpc("create_tic_tac_toe_match", "{}");
  const raw = result?.payload;
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

export async function listMatches(limit = 20) {
  const activeSession = await authenticateDevice();
  return client.listMatches(activeSession, limit, true, "", 0, 2, "+label.game:tic_tac_toe");
}
