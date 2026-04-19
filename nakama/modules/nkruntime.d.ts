declare namespace nkruntime {
  interface Context {}
  interface Logger {
    info(message: string): void;
    debug(message: string): void;
  }
  interface Nakama {}
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
    registerMatch<TState>(name: string, handler: MatchHandler<TState>): void;
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
  type InitModule = (
    ctx: Context,
    logger: Logger,
    nk: Nakama,
    initializer: Initializer
  ) => void;
}
