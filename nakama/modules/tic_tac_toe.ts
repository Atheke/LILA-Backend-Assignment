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

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
  dispatcher.broadcastMessage(2, payload);
}

const TicTacToeMatch: nkruntime.MatchHandler<MatchState> = {
  matchInit(_ctx, _logger, _nk, _params) {
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
  },

  matchJoinAttempt(_ctx, _logger, _nk, dispatcher, _tick, state, presence, _metadata) {
    const players = Object.keys(state.players);
    const allowed = players.length < 2 || state.players[presence.userId] !== undefined;
    if (!allowed) {
      return { state, accept: false, rejectMessage: "Match is full." };
    }

    dispatcher.matchLabelUpdate(buildLabel(state));
    return { state, accept: true };
  },

  matchJoin(_ctx, _logger, _nk, dispatcher, _tick, state, presences) {
    for (const presence of presences) {
      if (!state.players[presence.userId]) {
        const symbol: "X" | "O" = Object.values(state.players).includes("X") ? "O" : "X";
        state.players[presence.userId] = symbol;
      }
    }

    if (!state.turn) {
      const xPlayer = Object.entries(state.players).find(([, symbol]) => symbol === "X");
      state.turn = xPlayer ? xPlayer[0] : null;
    }

    dispatcher.matchLabelUpdate(buildLabel(state));
    broadcastState(dispatcher, state);
    return { state };
  },

  matchLoop(_ctx, logger, _nk, dispatcher, _tick, state, messages) {
    for (const message of messages) {
      if (message.opCode !== 1) {
        continue;
      }

      if (state.winner !== null) {
        continue;
      }

      if (state.turn !== message.sender.userId) {
        logger.debug("Rejected move: not player's turn.");
        continue;
      }

      let payload: MovePayload;
      try {
        payload = JSON.parse(decoder.decode(message.data)) as MovePayload;
      } catch (_error) {
        logger.debug("Rejected move: invalid payload.");
        continue;
      }

      if (!Number.isInteger(payload.index) || payload.index < 0 || payload.index > 8) {
        logger.debug("Rejected move: invalid index.");
        continue;
      }

      if (state.board[payload.index] !== "") {
        logger.debug("Rejected move: cell already occupied.");
        continue;
      }

      const symbol = state.players[message.sender.userId];
      if (!symbol) {
        logger.debug("Rejected move: sender not in player map.");
        continue;
      }

      state.board[payload.index] = symbol;
      state.winner = detectWinner(state.board);

      if (state.winner === null) {
        const nextPlayer = Object.keys(state.players).find((playerId) => playerId !== message.sender.userId) || null;
        state.turn = nextPlayer;
      }

      dispatcher.matchLabelUpdate(buildLabel(state));
      broadcastState(dispatcher, state);
    }

    return { state };
  },

  matchLeave(_ctx, _logger, _nk, dispatcher, _tick, state, presences) {
    for (const presence of presences) {
      delete state.players[presence.userId];
      if (state.turn === presence.userId) {
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
  },

  matchTerminate(_ctx, _logger, _nk, dispatcher, _tick, state, _graceSeconds) {
    broadcastState(dispatcher, state);
    return { state };
  },

  matchSignal(_ctx, _logger, _nk, _dispatcher, _tick, state, data) {
    return { state, data };
  }
};

export { MatchState, TicTacToeMatch };
