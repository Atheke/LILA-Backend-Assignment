"use strict";
// Nakama loads only index.js from the runtime path (server entrypoint). All handlers + InitModule must live here.
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
class SafeTextEncoder {
    encode(input) {
        const escaped = unescape(encodeURIComponent(input));
        const bytes = new Uint8Array(escaped.length);
        for (let i = 0; i < escaped.length; i++) {
            bytes[i] = escaped.charCodeAt(i);
        }
        return bytes;
    }
}
class SafeTextDecoder {
    decode(input) {
        let encoded = "";
        for (let i = 0; i < input.length; i++) {
            encoded += String.fromCharCode(input[i]);
        }
        return decodeURIComponent(escape(encoded));
    }
}
const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : new SafeTextEncoder();
const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : new SafeTextDecoder();
function detectWinner(board) {
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
function buildLabel(state) {
    const label = {
        game: "tic_tac_toe",
        open: Object.keys(state.players).length < 2 && state.winner === null,
        playerCount: Object.keys(state.players).length
    };
    return JSON.stringify(label);
}
function broadcastState(dispatcher, state) {
    const payload = encoder.encode(JSON.stringify(state));
    const buffer = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
    dispatcher.broadcastMessage(2, buffer);
}
function getUserId(presence) {
    if (!presence) {
        return "";
    }
    const direct = (typeof presence.userId === "string" && presence.userId) ||
        (typeof presence.user_id === "string" && presence.user_id) ||
        (typeof presence.username === "string" && presence.username) ||
        (typeof presence.sessionId === "string" && presence.sessionId) ||
        (typeof presence.session_id === "string" && presence.session_id) ||
        "";
    if (direct) {
        return direct;
    }
    const objectPresence = presence;
    for (const [key, value] of Object.entries(objectPresence)) {
        if (typeof value === "string" && value.length > 0 && (key.toLowerCase().includes("user") || key.toLowerCase().includes("session"))) {
            return value;
        }
    }
    return "";
}
function decodeMatchData(data) {
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
function matchInit(_ctx, _logger, _nk, _params) {
    const state = {
        board: Array(9).fill(""),
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
function matchJoinAttempt(_ctx, _logger, _nk, dispatcher, _tick, state, presence, _metadata) {
    const players = Object.keys(state.players);
    const userId = getUserId(presence);
    const allowed = players.length < 2 || state.players[userId] !== undefined;
    if (!allowed) {
        return { state, accept: false, rejectMessage: "Match is full." };
    }
    dispatcher.matchLabelUpdate(buildLabel(state));
    return { state, accept: true };
}
function matchJoin(_ctx, _logger, _nk, dispatcher, _tick, state, presences) {
    for (const presence of presences) {
        const userId = getUserId(presence);
        if (!userId) {
            continue;
        }
        if (!state.players[userId]) {
            const symbol = Object.values(state.players).includes("X") ? "O" : "X";
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
function matchLoop(_ctx, _logger, _nk, dispatcher, _tick, state, messages) {
    var _a, _b;
    for (const message of messages) {
        const opCode = (_b = (_a = message.opCode) !== null && _a !== void 0 ? _a : message.op_code) !== null && _b !== void 0 ? _b : -1;
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
            state.board = Array(9).fill("");
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
        let payload;
        try {
            payload = JSON.parse(decodeMatchData(message.data));
        }
        catch (_error) {
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
function matchLeave(_ctx, _logger, _nk, dispatcher, _tick, state, presences) {
    for (const presence of presences) {
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
function matchTerminate(_ctx, _logger, _nk, dispatcher, _tick, state, _graceSeconds) {
    broadcastState(dispatcher, state);
    return { state };
}
function matchSignal(_ctx, _logger, _nk, _dispatcher, _tick, state, data) {
    return { state, data };
}
function createTicTacToeMatch(_ctx, _logger, nk, _payload) {
    const matchId = nk.matchCreate("tic_tac_toe", {});
    return JSON.stringify({ matchId });
}
function InitModule(_ctx, _logger, _nk, initializer) {
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
