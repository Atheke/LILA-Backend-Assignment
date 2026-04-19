import { Client, Session, Socket } from "@heroiclabs/nakama-js";

const serverKey = "defaultkey";
const host = "127.0.0.1";
const port = "7350";
const useSSL = false;

const client = new Client(serverKey, host, port, useSSL);

let session: Session | null = null;
let socket: Socket | null = null;

export async function authenticateDevice(): Promise<Session> {
  if (session && !session.isexpired(Date.now() / 1000)) {
    return session;
  }

  const storageKey = "ttt-device-id";
  const existingDeviceId = localStorage.getItem(storageKey);
  const deviceId = existingDeviceId ?? crypto.randomUUID();
  localStorage.setItem(storageKey, deviceId);

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
  return activeSession.user_id ?? "";
}

export async function createMatch(): Promise<string> {
  const activeSocket = await createSocket();
  const match = await activeSocket.createMatch("tic_tac_toe");
  if (!match.match_id) {
    throw new Error("Nakama did not return a match ID.");
  }
  return match.match_id;
}

export async function joinMatch(matchId: string) {
  const activeSocket = await createSocket();
  return activeSocket.joinMatch(matchId);
}

export async function sendMove(matchId: string, index: number): Promise<void> {
  const activeSocket = await createSocket();
  await activeSocket.sendMatchState(matchId, 1, JSON.stringify({ index }));
}

export async function listMatches(limit = 20) {
  const activeSession = await authenticateDevice();
  return client.listMatches(activeSession, limit, true, "", 0, 2, "+label.game:tic_tac_toe");
}
