type CellValue = "X" | "O" | "";
type WinnerValue = "X" | "O" | "draw" | null;

interface MatchLabel {
  game: "tic_tac_toe";
  open: boolean;
  playerCount: number;
}

interface MatchState {
  board: CellValue[];
  turn: string | null;
  winner: WinnerValue;
  players: Record<string, "X" | "O">;
}

interface MovePayload {
  index: number;
}

type RuntimePresence = nkruntime.Presence & {
  userId?: string;
  user_id?: string;
  username?: string;
  sessionId?: string;
  session_id?: string;
};

type RuntimeMatchData = nkruntime.MatchData & {
  opCode?: number;
  op_code?: number;
  sender?: RuntimePresence;
  data?: Uint8Array | ArrayBuffer | string;
};

const WIN_LINES: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

class SafeTextEncoder {
  encode(input: string): Uint8Array {
    const escaped = unescape(encodeURIComponent(input));
    const bytes = new Uint8Array(escaped.length);
    for (let i = 0; i < escaped.length; i++) {
      bytes[i] = escaped.charCodeAt(i);
    }
    return bytes;
  }
}

class SafeTextDecoder {
  decode(input: Uint8Array): string {
    let encoded = "";
    for (let i = 0; i < input.length; i++) {
      encoded += String.fromCharCode(input[i]);
    }
    return decodeURIComponent(escape(encoded));
  }
}

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : new SafeTextEncoder();
const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : new SafeTextDecoder();

function detectWinner(board: CellValue[]): WinnerValue {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] !== "" && board[a] === board[b] && board[b] === board[c]) {
      return board[a];
    }
  }

  if (board.every((cell) => cell !== "")) {
    return "draw";
  }

  return null;
}

function buildLabel(state: MatchState): string {
  const label: MatchLabel = {
    game: "tic_tac_toe",
    open: Object.keys(state.players).length < 2 && state.winner === null,
    playerCount: Object.keys(state.players).length
  };

  return JSON.stringify(label);
}

function broadcastState(dispatcher: nkruntime.MatchDispatcher, state: MatchState): void {
  const payload = encoder.encode(JSON.stringify(state));
  const buffer = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
  dispatcher.broadcastMessage(2, buffer as unknown as Uint8Array);
}

function getUserId(presence: RuntimePresence | undefined): string {
  if (!presence) {
    return "";
  }

  const direct =
    (typeof presence.userId === "string" && presence.userId) ||
    (typeof presence.user_id === "string" && presence.user_id) ||
    (typeof presence.username === "string" && presence.username) ||
    (typeof presence.sessionId === "string" && presence.sessionId) ||
    (typeof presence.session_id === "string" && presence.session_id) ||
    "";

  if (direct) {
    return direct;
  }

  const objectPresence = presence as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(objectPresence)) {
    if (typeof value === "string" && value.length > 0 && (key.toLowerCase().includes("user") || key.toLowerCase().includes("session"))) {
      return value;
    }
  }

  return "";
}

function decodeMatchData(data: Uint8Array | ArrayBuffer | string | undefined): string {
  if (typeof data === "string") {
    return data;
  }

  if (!data) {
    return "";
  }

  if (data instanceof Uint8Array) {
    return decoder.decode(data);
  }

  if (data instanceof ArrayBuffer) {
    return decoder.decode(new Uint8Array(data));
  }

  return "";
}

function matchInit(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _params: unknown) {
  const state: MatchState = {
    board: Array<CellValue>(9).fill(""),
    turn: null,
    winner: null,
    players: {}
  };

  return {
    state,
    tickRate: 1,
    label: buildLabel(state)
  };
}

function matchJoinAttempt(
  _ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: MatchState,
  presence: nkruntime.Presence,
  _metadata: Record<string, unknown>
) {
  const players = Object.keys(state.players);
  const userId = getUserId(presence as RuntimePresence);
  const allowed = players.length < 2 || state.players[userId] !== undefined;
  if (!allowed) {
    return { state, accept: false, rejectMessage: "Match is full." };
  }

  dispatcher.matchLabelUpdate(buildLabel(state));
  return { state, accept: true };
}

function matchJoin(
  _ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: MatchState,
  presences: nkruntime.Presence[]
) {
  for (const presence of presences as RuntimePresence[]) {
    const userId = getUserId(presence);
    if (!userId) {
      continue;
    }
    if (!state.players[userId]) {
      const symbol: "X" | "O" = Object.values(state.players).includes("X") ? "O" : "X";
      state.players[userId] = symbol;
    }
  }

  if (!state.turn) {
    const xPlayer = Object.entries(state.players).find(([, symbol]) => symbol === "X");
    state.turn = xPlayer ? xPlayer[0] : null;
  }

  dispatcher.matchLabelUpdate(buildLabel(state));
  broadcastState(dispatcher, state);
  return { state };
}

function matchLoop(
  _ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: MatchState,
  messages: nkruntime.MatchData[]
) {
  for (const message of messages as RuntimeMatchData[]) {
    const opCode = message.opCode ?? message.op_code ?? -1;
    const senderId = getUserId(message.sender);
    if (!senderId) {
      continue;
    }

    if (opCode === 3) {
      if (!state.players[senderId]) {
        continue;
      }
      if (Object.keys(state.players).length < 2) {
        continue;
      }
      state.board = Array<CellValue>(9).fill("");
      state.winner = null;
      const xPlayer = Object.entries(state.players).find(([, symbol]) => symbol === "X");
      state.turn = xPlayer ? xPlayer[0] : Object.keys(state.players)[0] || null;
      dispatcher.matchLabelUpdate(buildLabel(state));
      broadcastState(dispatcher, state);
      continue;
    }

    if (opCode !== 1) {
      continue;
    }

    if (state.winner !== null) {
      continue;
    }

    if (state.turn !== senderId) {
      continue;
    }

    let payload: MovePayload;
    try {
      payload = JSON.parse(decodeMatchData(message.data)) as MovePayload;
    } catch (_error) {
      continue;
    }

    if (!Number.isInteger(payload.index) || payload.index < 0 || payload.index > 8) {
      continue;
    }

    if (state.board[payload.index] !== "") {
      continue;
    }

    const symbol = state.players[senderId];
    if (!symbol) {
      continue;
    }

    state.board[payload.index] = symbol;
    state.winner = detectWinner(state.board);

    if (state.winner === null) {
      const nextPlayer = Object.keys(state.players).find((playerId) => playerId !== senderId) || null;
      state.turn = nextPlayer;
    }

    dispatcher.matchLabelUpdate(buildLabel(state));
    broadcastState(dispatcher, state);
  }

  return { state };
}

function matchLeave(
  _ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: MatchState,
  presences: nkruntime.Presence[]
) {
  for (const presence of presences as RuntimePresence[]) {
    const userId = getUserId(presence);
    if (!userId) {
      continue;
    }
    delete state.players[userId];
    if (state.turn === userId) {
      const nextPlayer = Object.keys(state.players)[0];
      state.turn = nextPlayer || null;
    }
  }

  if (Object.keys(state.players).length === 0) {
    return null;
  }

  dispatcher.matchLabelUpdate(buildLabel(state));
  broadcastState(dispatcher, state);
  return { state };
}

function matchTerminate(
  _ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: MatchState,
  _graceSeconds: number
) {
  broadcastState(dispatcher, state);
  return { state };
}

function matchSignal(
  _ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: MatchState,
  data: string
) {
  return { state, data };
}

function createTicTacToeMatch(_ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
  const matchId = nk.matchCreate("tic_tac_toe", {});
  return JSON.stringify({ matchId });
}

function InitModule(
  _ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
): void {
  initializer.registerMatch("tic_tac_toe", {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLoop: matchLoop,
    matchLeave: matchLeave,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal
  });
  initializer.registerRpc("create_tic_tac_toe_match", createTicTacToeMatch);
}
