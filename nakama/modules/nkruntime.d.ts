declare namespace nkruntime {
  interface Context {}
  interface Logger {
    info(message: string): void;
    debug(message: string): void;
  }
  interface Presence {
    userId: string;
    sessionId: string;
    username: string;
    node: string;
  }
  interface MatchData {
    opCode: number;
    data: Uint8Array;
    sender: Presence;
  }
  interface MatchDispatcher {
    broadcastMessage(opCode: number, data: Uint8Array): void;
    matchLabelUpdate(label: string): void;
  }
  interface MatchJoinAttemptResult<TState> {
    state: TState;
    accept: boolean;
    rejectMessage?: string;
  }
  interface MatchInitResult<TState> {
    state: TState;
    tickRate: number;
    label: string;
  }
  interface MatchLoopResult<TState> {
    state: TState;
  }
  interface MatchTerminateResult<TState> {
    state: TState;
  }
  interface MatchSignalResult<TState> {
    state: TState;
    data: string;
  }
  interface Initializer {
    registerMatch<TState>(name: string, handler: MatchHandler<TState> | Record<string, string>): void;
    registerRpc(id: string, fn: (ctx: Context, logger: Logger, nk: Nakama, payload: string) => string): void;
  }
  /** Runtime exposes more methods; declare those used by the module. */
  interface Nakama {
    matchCreate(module: string, params: Record<string, unknown>): string;
    leaderboardCreate(
      id: string,
      authoritative?: boolean,
      sortOrder?: string,
      operator?: string,
      resetSchedule?: string,
      metadata?: Record<string, unknown>,
      enableRanks?: boolean
    ): void;
    leaderboardRecordWrite(
      id: string,
      ownerId: string,
      username?: string,
      score?: number,
      subscore?: number,
      metadata?: Record<string, unknown>,
      overrideOperator?: string
    ): unknown;
    storageRead(ids: Array<{ collection: string; key: string; userId?: string }>): StorageReadResult[];
    storageWrite(writes: StorageWriteInput[]): unknown;
    usersGetId(userIds: string[]): Array<{ userId?: string; username?: string }>;
  }
  interface StorageReadResult {
    key: string;
    collection: string;
    userId?: string;
    version?: string;
    value: Record<string, unknown>;
  }
  interface StorageWriteInput {
    collection: string;
    key: string;
    userId?: string;
    value: Record<string, unknown>;
    version?: string;
    permissionRead?: number;
    permissionWrite?: number;
  }
  interface MatchHandler<TState> {
    matchInit(ctx: Context, logger: Logger, nk: Nakama, params: Record<string, unknown>): MatchInitResult<TState>;
    matchJoinAttempt(
      ctx: Context,
      logger: Logger,
      nk: Nakama,
      dispatcher: MatchDispatcher,
      tick: number,
      state: TState,
      presence: Presence,
      metadata: Record<string, unknown>
    ): MatchJoinAttemptResult<TState>;
    matchJoin(
      ctx: Context,
      logger: Logger,
      nk: Nakama,
      dispatcher: MatchDispatcher,
      tick: number,
      state: TState,
      presences: Presence[]
    ): MatchLoopResult<TState>;
    matchLoop(
      ctx: Context,
      logger: Logger,
      nk: Nakama,
      dispatcher: MatchDispatcher,
      tick: number,
      state: TState,
      messages: MatchData[]
    ): MatchLoopResult<TState>;
    matchLeave(
      ctx: Context,
      logger: Logger,
      nk: Nakama,
      dispatcher: MatchDispatcher,
      tick: number,
      state: TState,
      presences: Presence[]
    ): MatchLoopResult<TState> | null;
    matchTerminate(
      ctx: Context,
      logger: Logger,
      nk: Nakama,
      dispatcher: MatchDispatcher,
      tick: number,
      state: TState,
      graceSeconds: number
    ): MatchTerminateResult<TState>;
    matchSignal(
      ctx: Context,
      logger: Logger,
      nk: Nakama,
      dispatcher: MatchDispatcher,
      tick: number,
      state: TState,
      data: string
    ): MatchSignalResult<TState>;
  }
  type InitModule = (ctx: Context, logger: Logger, nk: Nakama, initializer: Initializer) => void;
}
