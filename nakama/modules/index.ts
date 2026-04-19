import { TicTacToeMatch } from "./tic_tac_toe";

const InitModule: nkruntime.InitModule = function (
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
): void {
  initializer.registerMatch("tic_tac_toe", TicTacToeMatch);
  logger.info("Registered match handler: tic_tac_toe");
};

export { InitModule };
