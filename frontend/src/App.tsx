import { useState } from "react";
import { createMatch, createSocket, getCurrentUserId, joinMatch, listMatches, sendMove } from "./nakama";

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
}

function App(): JSX.Element {
  const [connected, setConnected] = useState(false);
  const [matchId, setMatchId] = useState("");
  const [joinId, setJoinId] = useState("");
  const [playerCount, setPlayerCount] = useState(0);
  const [error, setError] = useState("");
  const [availableMatches, setAvailableMatches] = useState<MatchListing[]>([]);
  const [board, setBoard] = useState<CellValue[]>(Array<CellValue>(9).fill(""));
  const [turn, setTurn] = useState<string | null>(null);
  const [players, setPlayers] = useState<Record<string, "X" | "O">>({});
  const [winner, setWinner] = useState<WinnerValue>(null);
  const [userId, setUserId] = useState("");
  const decoder = new TextDecoder();
  const mySymbol = userId ? players[userId] : undefined;
  const isMyTurn = turn !== null && turn === userId;

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
      return "Waiting to be assigned a symbol.";
    }
    return isMyTurn ? "Your turn" : "Opponent's turn";
  })();

  const connect = async () => {
    try {
      await createSocket();
      const socket = await createSocket();
      setUserId(await getCurrentUserId());
      socket.onmatchdata = (matchData) => {
        if (matchData.op_code !== 2) {
          return;
        }

        try {
          const decoded =
            matchData.data instanceof Uint8Array ? decoder.decode(matchData.data) : String(matchData.data);
          const state = JSON.parse(decoded) as MatchState;
          setBoard(state.board);
          setTurn(state.turn);
          setPlayers(state.players);
          setWinner(state.winner);
        } catch (parseError) {
          setError(`State update parse failed: ${String(parseError)}`);
        }
      };
      setConnected(true);
      setError("");
    } catch (err) {
      setError(`Connect failed: ${String(err)}`);
    }
  };

  const onCreateMatch = async () => {
    try {
      const id = await createMatch();
      const joined = await joinMatch(id);
      setMatchId(joined.match_id);
      setPlayerCount(joined.presences.length);
      setError("");
    } catch (err) {
      setError(`Create failed: ${String(err)}`);
    }
  };

  const onJoinMatch = async () => {
    if (!joinId.trim()) {
      return;
    }
    try {
      const joined = await joinMatch(joinId.trim());
      setMatchId(joined.match_id);
      setPlayerCount(joined.presences.length);
      setError("");
    } catch (err) {
      setError(`Join failed: ${String(err)}`);
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
      setError(`Move failed: ${String(err)}`);
    }
  };

  const refreshMatches = async () => {
    try {
      const result = await listMatches();
      setAvailableMatches(
        result.matches.map((match) => ({
          match_id: match.match_id,
          size: match.size
        }))
      );
    } catch (err) {
      setError(`Match listing failed: ${String(err)}`);
    }
  };

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}>
      <h1>Multiplayer Tic-Tac-Toe</h1>
      <p>Backend-authoritative match flow with Nakama.</p>
      <div style={{ display: "grid", gap: 8 }}>
        <button type="button" onClick={connect} disabled={connected}>
          {connected ? "Connected" : "Connect to Nakama"}
        </button>
        <button type="button" onClick={onCreateMatch} disabled={!connected}>
          Create Match
        </button>
        <input
          value={joinId}
          onChange={(event) => setJoinId(event.target.value)}
          placeholder="Enter match ID to join"
        />
        <button type="button" onClick={onJoinMatch} disabled={!connected}>
          Join Match
        </button>
        <button type="button" onClick={refreshMatches} disabled={!connected}>
          Discover Open Matches
        </button>
      </div>

      {availableMatches.length > 0 && (
        <section style={{ marginTop: 12 }}>
          <p>
            <strong>Discovered matches:</strong>
          </p>
          {availableMatches.map((match) => (
            <button
              key={match.match_id}
              type="button"
              onClick={() => setJoinId(match.match_id)}
              style={{ marginRight: 8, marginBottom: 8 }}
            >
              {match.match_id} ({match.size}/2)
            </button>
          ))}
        </section>
      )}

      {matchId && (
        <section style={{ marginTop: 16 }}>
          <p>
            <strong>Match ID:</strong> {matchId}
          </p>
          <p>
            <strong>Player count:</strong> {playerCount}
          </p>
          <p>
            <strong>Turn:</strong> {turn ?? "waiting"}
          </p>
          <p>
            <strong>Winner:</strong> {winner ?? "none"}
          </p>
          <p>
            <strong>Player:</strong> {mySymbol ?? "spectator"}
          </p>
          <p>
            <strong>Status:</strong> {statusText}
          </p>
          <p>
            <strong>Players:</strong> {Object.keys(players).length}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 64px)", gap: 6, marginTop: 8 }}>
            {board.map((cell, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onCellClick(idx)}
                disabled={!matchId || winner !== null || turn !== userId || board[idx] !== ""}
                style={{
                  width: 64,
                  height: 64,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid #aaa",
                  fontSize: 22
                }}
              >
                {cell}
              </button>
            ))}
          </div>
        </section>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </main>
  );
}

export default App;
