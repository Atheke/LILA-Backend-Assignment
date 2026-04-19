import { useState } from "react";
import { createMatch, createSocket, joinMatch } from "./nakama";

type CellValue = "X" | "O" | "";
type WinnerValue = "X" | "O" | "draw" | null;

interface MatchState {
  board: CellValue[];
  turn: string | null;
  winner: WinnerValue;
  players: Record<string, "X" | "O">;
}

function App(): JSX.Element {
  const [connected, setConnected] = useState(false);
  const [matchId, setMatchId] = useState("");
  const [joinId, setJoinId] = useState("");
  const [playerCount, setPlayerCount] = useState(0);
  const [error, setError] = useState("");
  const [board, setBoard] = useState<CellValue[]>(Array<CellValue>(9).fill(""));
  const [turn, setTurn] = useState<string | null>(null);
  const [players, setPlayers] = useState<Record<string, "X" | "O">>({});
  const [winner, setWinner] = useState<WinnerValue>(null);
  const decoder = new TextDecoder();

  const connect = async () => {
    try {
      await createSocket();
      const socket = await createSocket();
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
      </div>

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
            <strong>Players:</strong> {Object.keys(players).length}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 64px)", gap: 6, marginTop: 8 }}>
            {board.map((cell, idx) => (
              <div
                key={idx}
                style={{
                  width: 64,
                  height: 64,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid #aaa"
                }}
              >
                {cell}
              </div>
            ))}
          </div>
        </section>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </main>
  );
}

export default App;
