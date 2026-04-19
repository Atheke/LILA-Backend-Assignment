import { useEffect, useMemo, useState } from "react";
import {
  createMatch,
  createSocket,
  formatNakamaClientError,
  getCurrentUserId,
  joinMatch,
  leaveMatch,
  listMatches,
  sendMove,
  sendRestart
} from "./nakama";

type CellValue = "X" | "O" | "";
type WinnerValue = "X" | "O" | "draw" | null;

interface MatchState {
  board: CellValue[];
  turn: string | null;
  winner: WinnerValue;
  players: Record<string, "X" | "O">;
}

interface MatchListing {
  match_id: string;
  size: number;
  open: boolean;
  playerCount: number;
}

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

function App(): JSX.Element {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [matchId, setMatchId] = useState("");
  const [joinId, setJoinId] = useState("");
  const [error, setError] = useState("");
  const [searchingMatch, setSearchingMatch] = useState(false);
  const [searchStatus, setSearchStatus] = useState("");
  const [availableMatches, setAvailableMatches] = useState<MatchListing[]>([]);
  const [board, setBoard] = useState<CellValue[]>(Array<CellValue>(9).fill(""));
  const [turn, setTurn] = useState<string | null>(null);
  const [players, setPlayers] = useState<Record<string, "X" | "O">>({});
  const [winner, setWinner] = useState<WinnerValue>(null);
  const [userId, setUserId] = useState("");
  const decoder = useMemo(() => new TextDecoder(), []);
  const mySymbol = userId ? players[userId] : undefined;
  const playerCount = Object.keys(players).length;
  const isMyTurn = turn !== null && turn === userId;
  const turnSymbol = turn ? players[turn] : undefined;
  const myPlayerLabel = mySymbol === "X" ? "Player 1 (X)" : mySymbol === "O" ? "Player 2 (O)" : "Spectator";
  const turnLabel = turnSymbol === "X" ? "Player 1 (X)" : turnSymbol === "O" ? "Player 2 (O)" : "waiting";
  const winnerLabel = winner === "X" ? "Player 1 (X)" : winner === "O" ? "Player 2 (O)" : winner ?? "none";
  const winningCells = (() => {
    if (winner !== "X" && winner !== "O") {
      return new Set<number>();
    }

    const line = WIN_LINES.find(([a, b, c]) => board[a] === winner && board[b] === winner && board[c] === winner);
    return new Set<number>(line ?? []);
  })();
  const winnerMessage = winner === "draw" ? "It is a draw!" : winner ? `${winnerLabel} wins!` : "";
  const didIWin = winner !== null && winner !== "draw" && mySymbol === winner;

  const statusText = (() => {
    if (winner === "draw") {
      return "Game ended in a draw.";
    }
    if (winner) {
      if (mySymbol && winner === mySymbol) {
        return "You won!";
      }
      return "Opponent won.";
    }
    if (!matchId) {
      return "Create or join a match to start.";
    }
    if (!mySymbol) {
      return playerCount < 2 ? "Waiting for opponent. X plays first." : "Waiting to be assigned a symbol.";
    }
    if (playerCount < 2) return "Waiting for opponent. X plays first.";
    return isMyTurn ? `Your turn (${myPlayerLabel})` : `Opponent's turn (${turnLabel})`;
  })();

  const decodePayload = (payload: unknown): string => {
    if (payload instanceof Uint8Array) return decoder.decode(payload);
    if (payload instanceof ArrayBuffer) return decoder.decode(new Uint8Array(payload));
    if (Array.isArray(payload)) return decoder.decode(new Uint8Array(payload));
    return String(payload);
  };

  const parseMatchListings = (matches: Array<{ match_id: string; size?: number; label?: string }>): MatchListing[] => {
    return matches
      .filter((match): match is { match_id: string; size?: number; label?: string } => typeof match.match_id === "string")
      .map((match) => ({
        match_id: match.match_id,
        size: typeof match.size === "number" ? match.size : 0,
        open: (() => {
          try {
            const parsed = match.label ? (JSON.parse(match.label) as { open?: boolean }) : {};
            return parsed.open !== false;
          } catch {
            return true;
          }
        })(),
        playerCount: (() => {
          try {
            const parsed = match.label ? (JSON.parse(match.label) as { playerCount?: number }) : {};
            return typeof parsed.playerCount === "number" ? parsed.playerCount : typeof match.size === "number" ? match.size : 0;
          } catch {
            return typeof match.size === "number" ? match.size : 0;
          }
        })()
      }))
      .slice(0, 20);
  };

  const connect = async (): Promise<void> => {
    try {
      const socket = await createSocket();
      const currentUserId = await getCurrentUserId();
      setUserId(currentUserId);
      socket.onmatchdata = (matchData) => {
        if (matchData.op_code !== 2) {
          return;
        }

        try {
          const decoded = decodePayload(matchData.data);
          const state = JSON.parse(decoded) as MatchState;
          setBoard(state.board);
          setTurn(state.turn);
          setPlayers(state.players);
          setWinner(state.winner);
          setError("");
        } catch (parseError) {
          setError(`State update parse failed: ${String(parseError)}`);
        }
      };
      setConnected(true);
      setConnecting(false);
      setError("");
    } catch (err) {
      setConnecting(false);
      setError(`Connect failed: ${formatNakamaClientError(err)}`);
    }
  };

  const onCreateMatch = async () => {
    try {
      const id = await createMatch();
      const joined = await joinMatch(id);
      if (!joined.match_id) {
        throw new Error("Join did not return a match ID.");
      }
      setMatchId(joined.match_id);
      setError("");
    } catch (err) {
      setError(`Create failed: ${formatNakamaClientError(err)}`);
    }
  };

  const onJoinMatch = async () => {
    if (!joinId.trim()) {
      return;
    }
    try {
      const joined = await joinMatch(joinId.trim());
      if (!joined.match_id) {
        throw new Error("Join did not return a match ID.");
      }
      setMatchId(joined.match_id);
      setError("");
    } catch (err) {
      setError(`Join failed: ${formatNakamaClientError(err)}`);
    }
  };

  const onCellClick = async (index: number) => {
    if (!matchId || winner !== null) {
      return;
    }

    if (turn !== userId) {
      return;
    }

    if (board[index] !== "") {
      return;
    }

    try {
      await sendMove(matchId, index);
    } catch (err) {
      setError(`Move failed: ${formatNakamaClientError(err)}`);
    }
  };

  const onRestart = async () => {
    if (!matchId) return;
    try {
      await sendRestart(matchId);
    } catch (err) {
      setError(`Restart failed: ${formatNakamaClientError(err)}`);
    }
  };

  const onQuit = async () => {
    if (!matchId) return;
    try {
      await leaveMatch(matchId);
    } catch {
    } finally {
      setMatchId("");
      setJoinId("");
      setBoard(Array<CellValue>(9).fill(""));
      setTurn(null);
      setPlayers({});
      setWinner(null);
      setError("");
    }
  };

  const refreshMatches = async () => {
    try {
      const result = await listMatches();
      const matches = result.matches ?? [];
      setAvailableMatches(parseMatchListings(matches as Array<{ match_id: string; size?: number; label?: string }>));
      setError("");
    } catch (err) {
      setError(`Match listing failed: ${formatNakamaClientError(err)}`);
    }
  };

  const discoverAndJoinOpenMatch = async () => {
    if (!connected || searchingMatch) return;
    setSearchingMatch(true);
    setSearchStatus("Searching for available match...");
    setError("");

    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        const result = await listMatches();
        const parsed = parseMatchListings((result.matches ?? []) as Array<{ match_id: string; size?: number; label?: string }>);
        setAvailableMatches(parsed);

        const openMatch = parsed.find((m) => m.open && m.playerCount === 1);
        if (openMatch) {
          setSearchStatus("Match found. Joining...");
          const joined = await joinMatch(openMatch.match_id);
          if (!joined.match_id) {
            throw new Error("Join did not return a match ID.");
          }
          setMatchId(joined.match_id);
          setSearchStatus("Joined match successfully.");
          setSearchingMatch(false);
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      setSearchStatus("No open matches found. Create one and wait for an opponent.");
    } catch (err) {
      setError(`Discover failed: ${formatNakamaClientError(err)}`);
    } finally {
      setSearchingMatch(false);
    }
  };

  const selectMatch = (id: string) => {
    setJoinId(id);
  };

  useEffect(() => {
    void connect();
  }, []);

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto grid w-full max-w-5xl gap-6 md:grid-cols-[360px_1fr]">
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
          <h1 className="text-2xl font-bold">Multiplayer Tic-Tac-Toe</h1>
          <p className="mt-1 text-sm text-slate-400">Nakama realtime match.</p>
          <div className="mt-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                connected ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"
              }`}
            >
              {connecting ? "Connecting..." : connected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <div className="mt-4 grid gap-3">
            <button
              type="button"
              onClick={onCreateMatch}
              disabled={!connected}
              className="rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              Create Match
            </button>
            <input
              value={joinId}
              onChange={(event) => setJoinId(event.target.value)}
              placeholder="Enter match ID"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
            <button
              type="button"
              onClick={onJoinMatch}
              disabled={!connected}
              className="rounded-lg bg-slate-700 px-4 py-2 font-medium transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Join Match
            </button>
            <button
              type="button"
              onClick={discoverAndJoinOpenMatch}
              disabled={!connected || searchingMatch}
              className="rounded-lg bg-slate-800 px-4 py-2 font-medium transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {searchingMatch ? "Searching..." : "Discover Open Matches"}
            </button>
          </div>
          {searchStatus && <p className="mt-3 text-xs text-slate-300">{searchStatus}</p>}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
          <div className="grid gap-2 text-sm text-slate-300 md:grid-cols-2">
            <p>
              Match ID: <span className="font-mono text-slate-100">{matchId || "not joined"}</span>
            </p>
            <p>Players: {playerCount}/2</p>
            <p>Turn: {turnLabel}</p>
            <p>Winner: {winnerLabel}</p>
            <p>You are: {myPlayerLabel}</p>
            <p>Status: {statusText}</p>
          </div>

          {availableMatches.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {availableMatches.map((match) => (
                <button
                  key={match.match_id}
                  type="button"
                  onClick={() => selectMatch(match.match_id)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    match.open ? "border-slate-700 hover:border-indigo-400" : "border-rose-500/40 text-rose-300"
                  }`}
                >
                  {match.match_id.slice(0, 8)}... ({match.playerCount}/2) {match.open ? "open" : "full"}
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onQuit}
              disabled={!matchId}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Quit Match
            </button>
            <button
              type="button"
              onClick={onRestart}
              disabled={!matchId || winner === null}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Restart Round
            </button>
          </div>

          <div className="mt-6 grid w-fit grid-cols-3 gap-2">
            {board.map((cell, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onCellClick(idx)}
                disabled={!matchId || winner !== null || turn !== userId || board[idx] !== "" || playerCount < 2}
                className={`flex h-20 w-20 items-center justify-center rounded-lg border bg-slate-950 text-3xl font-bold transition hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 ${
                  winningCells.has(idx) ? "border-emerald-500 text-emerald-200" : "border-slate-700 text-indigo-300"
                }`}
              >
                {cell}
              </button>
            ))}
          </div>
        </section>
      </div>

      {error && <p className="mx-auto mt-4 max-w-5xl rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-300">{error}</p>}

      {winner !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]">
          <div
            className={`w-full max-w-lg rounded-2xl border px-6 py-8 text-center shadow-2xl ${
              winner === "draw"
                ? "border-amber-300/40 bg-gradient-to-br from-amber-500/20 to-yellow-300/10"
                : didIWin
                  ? "border-emerald-300/40 bg-gradient-to-br from-emerald-500/25 to-cyan-400/10"
                  : "border-rose-300/40 bg-gradient-to-br from-rose-500/25 to-fuchsia-400/10"
            }`}
          >
            <p className="text-xs uppercase tracking-wide text-slate-300">Match complete</p>
            <h2 className="mt-3 text-3xl font-bold text-white">{winnerMessage}</h2>
            <p className="mt-3 text-sm text-slate-200">
              {winner === "draw" ? "Draw." : didIWin ? "You won." : "You lost."}
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={onRestart}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400"
              >
                Restart
              </button>
              <button
                type="button"
                onClick={onQuit}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600"
              >
                Quit
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
