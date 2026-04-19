import { useState } from "react";
import { createMatch, createSocket, joinMatch } from "./nakama";

function App(): JSX.Element {
  const [connected, setConnected] = useState(false);
  const [matchId, setMatchId] = useState("");
  const [joinId, setJoinId] = useState("");
  const [playerCount, setPlayerCount] = useState(0);
  const [error, setError] = useState("");

  const connect = async () => {
    try {
      await createSocket();
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
        </section>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </main>
  );
}

export default App;
