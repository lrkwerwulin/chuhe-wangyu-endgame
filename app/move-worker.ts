/// <reference lib="webworker" />

import {
  MATE_SCORE,
  searchForcedOutcome,
  type GameState,
} from '../lib/hybrid-engine';

interface MoveCheckRequest {
  token: number;
  state: GameState;
  depth: number;
}

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = ({ data }: MessageEvent<MoveCheckRequest>) => {
  try {
    // The state is already after the player's move, so the opponent is the
    // side to move. A negative mate score therefore proves that the player
    // still wins inside the remaining deadline.
    const result = searchForcedOutcome(data.state, data.depth);
    workerScope.postMessage({
      kind: 'result',
      token: data.token,
      report: {
        preservesDeadline: result.score < -MATE_SCORE / 2,
        opponentForcesMate: result.score > MATE_SCORE / 2,
        bestMove: result.bestMove,
        pv: result.pv,
        matePlies: result.matePlies,
      },
    });
  } catch (error) {
    workerScope.postMessage({
      kind: 'error',
      token: data.token,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
