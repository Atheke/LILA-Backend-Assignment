"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InitModule = void 0;
const tic_tac_toe_1 = require("./tic_tac_toe");
const InitModule = function (_ctx, logger, _nk, initializer) {
    initializer.registerMatch("tic_tac_toe", tic_tac_toe_1.TicTacToeMatch);
    logger.info("Registered match handler: tic_tac_toe");
};
exports.InitModule = InitModule;
