import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LeaderboardRecord } from "@heroiclabs/nakama-js";
import {
  authenticateWithUsername,
  createMatch,
  createSocket,
  fetchMyLeaderboardRecord,
  fetchTopLeaderboardRecords,
  formatNakamaClientError,
  GameMode,
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
  mode?: GameMode;
  secondsLeft?: number | null;
  endReason?: "timeout" | null;
}

interface MatchListing {
  match_id: string;
  size: number;
  open: boolean;
  playerCount: number;
  mode: GameMode;
}

const USERNAME_STORAGE_KEY = "ttt-username";

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
  const [usernameInput, setUsernameInput] = useState(() => {
    try {
      return localStorage.getItem(USERNAME_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(() => {
    try {
      return Boolean(localStorage.getItem(USERNAME_STORAGE_KEY));
    } catch {
      return false;
    }
  });
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
  const [matchMode, setMatchMode] = useState<GameMode>("classic");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [endReason, setEndReason] = useState<"timeout" | null>(null);
  const [userId, setUserId] = useState("");
  const [gameMode, setGameMode] = useState<GameMode>("classic");
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRecord[]>([]);
  const [myRecord, setMyRecord] = useState<LeaderboardRecord | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

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
      if (endReason === "timeout") {
        return didIWin ? "You won on time." : "You ran out of time.";
      }
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
    if (matchMode === "timed" && typeof secondsLeft === "number" && isMyTurn) {
      return `Your turn — ${secondsLeft}s left`;
    }
    if (matchMode === "timed" && typeof secondsLeft === "number" && !isMyTurn && turn) {
      return `Opponent's turn — ${secondsLeft}s on their clock`;
    }
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
      .map((match) => {
        let open = true;
        let playerCount = 0;
        let mode: GameMode = "classic";
        try {
          const parsed = match.label ? (JSON.parse(match.label) as { open?: boolean; playerCount?: number; mode?: string }) : {};
          open = parsed.open !== false;
          playerCount = typeof parsed.playerCount === "number" ? parsed.playerCount : typeof match.size === "number" ? match.size : 0;
          mode = parsed.mode === "timed" ? "timed" : "classic";
        } catch {
          playerCount = typeof match.size === "number" ? match.size : 0;
        }
        return {
          match_id: match.match_id,
          size: typeof match.size === "number" ? match.size : 0,
          open,
          playerCount,
          mode
        };
      })
      .slice(0, 20);
  };

  const loadLeaderboard = useCallback(async () => {
    if (!connected) {
      return;
    }
    setLeaderboardLoading(true);
    try {
      const [top, mine] = await Promise.all([fetchTopLeaderboardRecords(12), fetchMyLeaderboardRecord()]);
      setLeaderboardRows(top);
      setMyRecord(mine);
    } catch (err) {
      setError(`Leaderboard failed: ${formatNakamaClientError(err)}`);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [connected]);

  const connectWithUsername = useCallback(
    async (rawName: string): Promise<void> => {
      const name = rawName.trim();
      if (name.length < 2) {
        setError("Username must be at least 2 characters.");
        return;
      }

      setConnecting(true);
      setError("");
      try {
        await authenticateWithUsername(name);
        try {
          localStorage.setItem(USERNAME_STORAGE_KEY, name);
        } catch {
          /* ignore */
        }

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
            setMatchMode(state.mode ?? "classic");
            setSecondsLeft(typeof state.secondsLeft === "number" ? state.secondsLeft : null);
            setEndReason(state.endReason === "timeout" ? "timeout" : null);
            setError("");
          } catch (parseError) {
            setError(`State update parse failed: ${String(parseError)}`);
          }
        };

        setConnected(true);
        setError("");
        void loadLeaderboard();
      } catch (err) {
        setError(`Connect failed: ${formatNakamaClientError(err)}`);
        setConnected(false);
      } finally {
        setConnecting(false);
      }
    },
    [decoder, loadLeaderboard]
  );

  const connectWithUsernameRef = useRef(connectWithUsername);
  connectWithUsernameRef.current = connectWithUsername;

  useEffect(() => {
    const saved = (() => {
      try {
        return localStorage.getItem(USERNAME_STORAGE_KEY);
      } catch {
        return null;
      }
    })();
    if (saved) {
      void connectWithUsernameRef.current(saved);
    } else {
      setConnecting(false);
    }
  }, []);

  useEffect(() => {
    if (!connected) {
      return;
    }
    void loadLeaderboard();
  }, [connected, loadLeaderboard, winner]);

  const onSubmitUsername = async () => {
    await connectWithUsername(usernameInput);
  };

  const onSignOut = () => {
    try {
      localStorage.removeItem(USERNAME_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  const onCreateMatch = async () => {
    try {
      const id = await createMatch(gameMode);
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
      setMatchMode("classic");
      setSecondsLeft(null);
      setEndReason(null);
      setError("");
    }
  };

  const refreshMatches = async () => {
    try {
      const result = await listMatches(20, gameMode);
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
    setSearchStatus(`Searching for ${gameMode} match...`);
    setError("");

    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        const result = await listMatches(20, gameMode);
        const parsed = parseMatchListings((result.matches ?? []) as Array<{ match_id: string; size?: number; label?: string }>);
        setAvailableMatches(parsed);

        const openMatch = parsed.find((m) => m.open && m.playerCount === 1 && m.mode === gameMode);
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

  const formatRecord = (r: LeaderboardRecord, rank: number) => {
    const meta = r.metadata as { wins?: number; losses?: number; winStreak?: number; bestWinStreak?: number } | undefined;
    const wins = meta?.wins ?? 0;
    const losses = meta?.losses ?? 0;
    const streak = meta?.winStreak ?? 0;
    const username = r.username && r.username.length > 0 ? r.username : r.owner_id?.slice(0, 8) ?? "?";
    return { rank, username, score: Number(r.score), wins, losses, streak };
  };

  if (!connected) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-white">Multiplayer Tic-Tac-Toe</h1>
          <p className="mt-2 text-sm text-slate-400">Choose a username to save stats and appear on the leaderboard.</p>
          <label className="mt-6 block text-xs font-medium uppercase tracking-wide text-slate-400" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void onSubmitUsername()}
            placeholder="e.g. alex_t"
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-400"
            autoComplete="username"
          />
          <p className="mt-2 text-xs text-slate-500">2–16 characters: letters, numbers, underscore, hyphen.</p>
          <button
            type="button"
            onClick={() => void onSubmitUsername()}
            disabled={connecting}
            className="mt-6 w-full rounded-lg bg-indigo-500 py-2.5 font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {connecting ? "Connecting..." : "Play"}
          </button>
          {error && <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto grid w-full max-w-6xl gap-6 md:grid-cols-[300px_1fr]">
        <section className="flex flex-col gap-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
          <h2 className="text-lg font-bold text-white">Leaderboard</h2>
          <p className="mt-1 text-xs text-slate-400">Rating = wins×10 − losses×5 (min 0). Streaks shown from metadata.</p>
          <button
            type="button"
            onClick={() => void loadLeaderboard()}
            disabled={leaderboardLoading}
            className="mt-3 w-full rounded-lg border border-slate-600 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {leaderboardLoading ? "Loading…" : "Refresh"}
          </button>
          {myRecord && (
            <div className="mt-4 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs">
              <p className="font-semibold text-indigo-200">You</p>
              <p className="mt-1 text-slate-200">
                Rating <span className="font-mono">{String(myRecord.score)}</span>
              </p>
              <p className="text-slate-400">
                W {(myRecord.metadata as { wins?: number })?.wins ?? 0} · L{" "}
                {(myRecord.metadata as { losses?: number })?.losses ?? 0} · streak{" "}
                {(myRecord.metadata as { winStreak?: number })?.winStreak ?? 0}
              </p>
            </div>
          )}
          <ol className="mt-4 space-y-2 text-xs">
            {leaderboardRows.map((r, i) => {
              const row = formatRecord(r, i + 1);
              return (
                <li key={r.owner_id} className="flex justify-between gap-2 rounded-lg bg-slate-950/80 px-2 py-2 text-slate-200">
                  <span className="text-slate-500">{row.rank}.</span>
                  <span className="flex-1 truncate font-medium">{row.username}</span>
                  <span className="font-mono text-emerald-300">{row.score}</span>
                </li>
              );
            })}
          </ol>
          {leaderboardRows.length === 0 && !leaderboardLoading && <p className="mt-4 text-xs text-slate-500">No records yet — finish a match.</p>}
          </div>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl font-bold text-white">Multiplayer Tic-Tac-Toe</h1>
              <p className="text-sm text-slate-400">
                Signed in as <span className="font-semibold text-indigo-300">{usernameInput.trim() || "player"}</span>
              </p>
            </div>
            <button type="button" onClick={onSignOut} className="text-xs text-slate-500 underline hover:text-slate-300">
              Sign out
            </button>
          </div>
          <div className="mt-3">
            <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300">Connected</span>
          </div>

          <fieldset className="mt-4 rounded-lg border border-slate-800 p-3">
            <legend className="px-1 text-xs text-slate-400">Match mode</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex cursor-pointer items-center gap-2 text-slate-200">
                <input type="radio" name="mode" checked={gameMode === "classic"} onChange={() => setGameMode("classic")} />
                Classic (no clock)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-slate-200">
                <input type="radio" name="mode" checked={gameMode === "timed"} onChange={() => setGameMode("timed")} />
                Timed (30s / move, forfeit)
              </label>
            </div>
          </fieldset>

          <div className="mt-4 grid gap-3">
            <button
              type="button"
              onClick={onCreateMatch}
              className="rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white transition hover:bg-indigo-400"
            >
              Create {gameMode === "timed" ? "Timed" : "Classic"} Match
            </button>
            <input
              value={joinId}
              onChange={(event) => setJoinId(event.target.value)}
              placeholder="Enter match ID"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
            <button type="button" onClick={onJoinMatch} className="rounded-lg bg-slate-700 px-4 py-2 font-medium transition hover:bg-slate-600">
              Join Match
            </button>
            <button
              type="button"
              onClick={discoverAndJoinOpenMatch}
              disabled={searchingMatch}
              className="rounded-lg bg-slate-800 px-4 py-2 font-medium transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {searchingMatch ? "Searching..." : "Discover Open Matches"}
            </button>
            <button type="button" onClick={() => void refreshMatches()} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">
              Refresh match list
            </button>
          </div>
          {searchStatus && <p className="mt-3 text-xs text-slate-300">{searchStatus}</p>}
          </section>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
          <div className="grid gap-2 text-sm text-slate-300">
            <p>
              Match ID: <span className="font-mono text-slate-100">{matchId || "not joined"}</span>
            </p>
            <p>Mode: {matchMode === "timed" ? "Timed (30s)" : "Classic"}</p>
            <p>Players: {playerCount}/2</p>
            <p>Turn: {turnLabel}</p>
            <p>Winner: {winnerLabel}</p>
            <p>You are: {myPlayerLabel}</p>
            <p>Status: {statusText}</p>
          </div>

          {matchMode === "timed" && matchId && playerCount >= 2 && winner === null && typeof secondsLeft === "number" && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Turn clock</span>
                <span className={secondsLeft <= 5 ? "font-bold text-amber-400" : ""}>{secondsLeft}s</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all ${secondsLeft <= 5 ? "bg-amber-500" : "bg-indigo-500"}`}
                  style={{ width: `${Math.min(100, (secondsLeft / 30) * 100)}%` }}
                />
              </div>
            </div>
          )}

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
                  {match.match_id.slice(0, 8)}… ({match.playerCount}/2) {match.mode === "timed" ? "⏱" : "○"}{" "}
                  {match.open ? "open" : "full"}
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

      {error && <p className="mx-auto mt-4 max-w-6xl rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-300">{error}</p>}

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
              {endReason === "timeout" && winner !== "draw" ? " (timeout)" : ""}
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={onRestart}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400"
              >
                Restart
              </button>
              <button type="button" onClick={onQuit} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600">
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
