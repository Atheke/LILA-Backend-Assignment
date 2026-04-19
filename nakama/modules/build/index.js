"use strict";
// Nakama loads only index.js from the runtime path (server entrypoint). All handlers + InitModule must live here.
const LEADERBOARD_ID = "tic_tac_toe_ranking";
const STATS_COLLECTION = "ttt_stats";
const STATS_KEY = "summary";
const TURN_SECONDS = 30;
/** Points added to leaderboard rating on a win (operator: set uses absolute formula). */
const WIN_POINTS = 10;
const LOSS_POINTS = 5;
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
        playerCount: Object.keys(state.players).length,
        mode: state.mode
    };
    return JSON.stringify(label);
}
function ratingScore(s) {
    return Math.max(0, s.wins * WIN_POINTS - s.losses * LOSS_POINTS);
}
function readUserStats(nk, userId) {
    const rows = nk.storageRead([{ collection: STATS_COLLECTION, key: STATS_KEY, userId }]);
    if (!rows || rows.length === 0) {
        return {
            stats: { wins: 0, losses: 0, winStreak: 0, bestWinStreak: 0 }
        };
    }
    const row = rows[0];
    const v = row.value;
    const stats = {
        wins: typeof v.wins === "number" ? v.wins : 0,
        losses: typeof v.losses === "number" ? v.losses : 0,
        winStreak: typeof v.winStreak === "number" ? v.winStreak : 0,
        bestWinStreak: typeof v.bestWinStreak === "number" ? v.bestWinStreak : 0
    };
    return { stats, version: row.version };
}
function writeUserStatsAndLeaderboard(nk, logger, userId, stats, version, presenceUsernameHint) {
    const username = resolvePlayerUsername(nk, logger, userId, presenceUsernameHint);
    const write = {
        collection: STATS_COLLECTION,
        key: STATS_KEY,
        userId,
        value: {
            wins: stats.wins,
            losses: stats.losses,
            winStreak: stats.winStreak,
            bestWinStreak: stats.bestWinStreak
        },
        permissionRead: 2,
        permissionWrite: 0
    };
    if (version) {
        write.version = version;
    }
    try {
        nk.storageWrite([write]);
    }
    catch (e) {
        logger.info(`storageWrite failed for ${userId}: ${String(e)}`);
        return;
    }
    const meta = {
        wins: stats.wins,
        losses: stats.losses,
        winStreak: stats.winStreak,
        bestWinStreak: stats.bestWinStreak
    };
    if (username.length > 0) {
        meta.displayName = username;
    }
    try {
        nk.leaderboardRecordWrite(LEADERBOARD_ID, userId, username.length > 0 ? username : undefined, ratingScore(stats), 0, meta, "set");
    }
    catch (e) {
        logger.info(`leaderboardRecordWrite failed for ${userId}: ${String(e)}`);
    }
}
function applyMatchStats(nk, logger, state) {
    if (state.statsApplied || state.winner === null) {
        return;
    }
    const ids = Object.keys(state.players);
    if (ids.length < 2) {
        return;
    }
    state.statsApplied = true;
    try {
        if (state.winner === "draw") {
            for (const uid of ids) {
                const { stats, version } = readUserStats(nk, uid);
                stats.winStreak = 0;
                writeUserStatsAndLeaderboard(nk, logger, uid, stats, version, state.usernames[uid]);
            }
            return;
        }
        const winnerSymbol = state.winner;
        const winnerUserId = ids.find((id) => state.players[id] === winnerSymbol);
        const loserUserId = ids.find((id) => state.players[id] !== winnerSymbol);
        if (!winnerUserId || !loserUserId) {
            return;
        }
        const wRead = readUserStats(nk, winnerUserId);
        wRead.stats.wins += 1;
        wRead.stats.winStreak += 1;
        wRead.stats.bestWinStreak = Math.max(wRead.stats.bestWinStreak, wRead.stats.winStreak);
        const lRead = readUserStats(nk, loserUserId);
        lRead.stats.losses += 1;
        lRead.stats.winStreak = 0;
        writeUserStatsAndLeaderboard(nk, logger, winnerUserId, wRead.stats, wRead.version, state.usernames[winnerUserId]);
        writeUserStatsAndLeaderboard(nk, logger, loserUserId, lRead.stats, lRead.version, state.usernames[loserUserId]);
    }
    catch (e) {
        logger.info(`applyMatchStats error: ${String(e)}`);
    }
}
function refreshTurnDeadline(state, tick) {
    if (state.mode !== "timed" || state.winner !== null) {
        state.turnDeadlineTick = null;
        return;
    }
    if (Object.keys(state.players).length < 2 || !state.turn) {
        state.turnDeadlineTick = null;
        return;
    }
    state.turnDeadlineTick = tick + TURN_SECONDS;
}
function broadcastState(dispatcher, state, tick) {
    const secondsLeft = state.mode === "timed" && state.turn && state.winner === null && state.turnDeadlineTick !== null
        ? Math.max(0, state.turnDeadlineTick - tick)
        : null;
    const clientState = {
        board: state.board,
        turn: state.turn,
        winner: state.winner,
        players: state.players,
        mode: state.mode,
        secondsLeft,
        endReason: state.endReason
    };
    const payload = encoder.encode(JSON.stringify(clientState));
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
function recordUsernameFromPresence(state, presence) {
    const rp = presence;
    const uid = getUserId(rp);
    const raw = typeof rp.username === "string" ? rp.username.trim() : "";
    if (uid && raw.length > 0) {
        state.usernames[uid] = raw;
    }
}
function resolvePlayerUsername(nk, logger, userId, fromMatch) {
    const hint = (fromMatch !== null && fromMatch !== void 0 ? fromMatch : "").trim();
    if (hint.length > 0) {
        return hint;
    }
    try {
        const users = nk.usersGetId([userId]);
        for (const row of users !== null && users !== void 0 ? users : []) {
            const u = row;
            if (typeof u.username === "string" && u.username.trim().length > 0) {
                if (!u.userId || u.userId === userId) {
                    return u.username.trim();
                }
            }
        }
    }
    catch (e) {
        logger.debug(`usersGetId ${userId}: ${String(e)}`);
    }
    try {
        const accounts = nk.accountsGetId([userId], []);
        const first = accounts && accounts[0];
        if (first && first.user && typeof first.user.username === "string" && first.user.username.trim().length > 0) {
            return first.user.username.trim();
        }
    }
    catch (e) {
        logger.debug(`accountsGetId ${userId}: ${String(e)}`);
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
function parseMode(params) {
    if (params && params.mode === "timed") {
        return "timed";
    }
    return "classic";
}
function matchInit(_ctx, _logger, _nk, params) {
    const mode = parseMode(params);
    const state = {
        board: Array(9).fill(""),
        turn: null,
        winner: null,
        players: {},
        mode,
        turnDeadlineTick: null,
        statsApplied: false,
        endReason: null,
        usernames: {}
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
    recordUsernameFromPresence(state, presence);
    dispatcher.matchLabelUpdate(buildLabel(state));
    return { state, accept: true };
}
function matchJoin(_ctx, _logger, _nk, dispatcher, tick, state, presences) {
    for (const presence of presences) {
        recordUsernameFromPresence(state, presence);
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
    refreshTurnDeadline(state, tick);
    dispatcher.matchLabelUpdate(buildLabel(state));
    broadcastState(dispatcher, state, tick);
    return { state };
}
function processTurnTimeout(nk, logger, dispatcher, tick, state) {
    if (state.mode !== "timed" ||
        state.winner !== null ||
        !state.turn ||
        state.turnDeadlineTick === null ||
        tick < state.turnDeadlineTick) {
        return;
    }
    const timedOutUser = state.turn;
    const opponent = Object.keys(state.players).find((uid) => uid !== timedOutUser);
    if (!opponent) {
        state.turnDeadlineTick = null;
        return;
    }
    const winnerSymbol = state.players[opponent];
    if (!winnerSymbol) {
        return;
    }
    state.winner = winnerSymbol;
    state.endReason = "timeout";
    state.turnDeadlineTick = null;
    applyMatchStats(nk, logger, state);
    dispatcher.matchLabelUpdate(buildLabel(state));
    broadcastState(dispatcher, state, tick);
}
function matchLoop(_ctx, logger, nk, dispatcher, tick, state, messages) {
    var _a, _b;
    processTurnTimeout(nk, logger, dispatcher, tick, state);
    for (const message of messages) {
        if (message.sender) {
            recordUsernameFromPresence(state, message.sender);
        }
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
            state.statsApplied = false;
            state.endReason = null;
            const xPlayer = Object.entries(state.players).find(([, symbol]) => symbol === "X");
            state.turn = xPlayer ? xPlayer[0] : Object.keys(state.players)[0] || null;
            refreshTurnDeadline(state, tick);
            dispatcher.matchLabelUpdate(buildLabel(state));
            broadcastState(dispatcher, state, tick);
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
            refreshTurnDeadline(state, tick);
        }
        else {
            state.turnDeadlineTick = null;
            state.endReason = null;
            applyMatchStats(nk, logger, state);
        }
        dispatcher.matchLabelUpdate(buildLabel(state));
        broadcastState(dispatcher, state, tick);
    }
    return { state };
}
function matchLeave(_ctx, _logger, _nk, dispatcher, tick, state, presences) {
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
    refreshTurnDeadline(state, tick);
    dispatcher.matchLabelUpdate(buildLabel(state));
    broadcastState(dispatcher, state, tick);
    return { state };
}
function matchTerminate(_ctx, _logger, _nk, dispatcher, tick, state, _graceSeconds) {
    broadcastState(dispatcher, state, tick);
    return { state };
}
function matchSignal(_ctx, _logger, _nk, _dispatcher, _tick, state, data) {
    return { state, data };
}
function createTicTacToeMatch(_ctx, _logger, nk, payload) {
    let mode = "classic";
    try {
        const parsed = JSON.parse(payload);
        if (parsed.mode === "timed") {
            mode = "timed";
        }
    }
    catch (_e) {
        /* empty payload */
    }
    const matchId = nk.matchCreate("tic_tac_toe", { mode });
    return JSON.stringify({ matchId });
}
function ensureLeaderboard(nk, logger) {
    try {
        nk.leaderboardCreate(LEADERBOARD_ID, true, "desc", "set", "", {}, true);
    }
    catch (e) {
        logger.debug(`leaderboardCreate: ${String(e)}`);
    }
}
function InitModule(_ctx, logger, nk, initializer) {
    ensureLeaderboard(nk, logger);
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
