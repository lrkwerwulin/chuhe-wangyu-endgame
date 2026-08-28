/// <reference lib="webworker" />

import {
  analyseMoveHorizons,
  formatMove,
  moveKey,
  proveForcedWinRigidity,
  type GameState,
} from '../lib/hybrid-engine';

interface VerificationRequest {
  token: number;
  state: GameState;
  depth: number;
  winnerTurns: number;
  uniqueWinnerTurns: number;
  maxWinningMoves: number;
}

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = ({ data }: MessageEvent<VerificationRequest>) => {
  try {
    const analysis = analyseMoveHorizons(data.state, data.depth);
    const winning = analysis.legal.filter((item) => item.finalOutcome === 'win');
    workerScope.postMessage({
      kind: 'horizons',
      token: data.token,
      report: {
        legal: analysis.legal.length,
        winning: winning.length,
        mateMoves: winning[0]?.horizons.at(-1)?.mateMoves ?? null,
        horizons: analysis.horizons.map((item) => ({
          horizon: item.horizon,
          wins: item.wins,
          losses: item.losses,
          unresolved: item.unresolved,
          newlyWins: item.newlyWins,
          newlyLosses: item.newlyLosses,
          searchedMoves: item.searchedMoves,
          nodes: item.stats.nodes,
          cutoffs: item.stats.cutoffs,
          tableHits: item.stats.tableHits,
          elapsedMs: Math.round(item.stats.elapsedMs),
        })),
        moves: analysis.legal.map((item) => ({
          key: moveKey(item.move),
          label: formatMove(data.state, item.move),
          replies: item.replyCount,
          capture: item.capture,
          check: item.givesCheck,
          promotion: item.promotion,
          firstProof: item.firstProvenHorizon,
          final: item.finalOutcome,
          outcomes: item.horizons.map((sample) => sample.outcome),
        })),
        horizonNodes: analysis.stats.nodes,
        horizonCutoffs: analysis.stats.cutoffs,
        horizonTableHits: analysis.stats.tableHits,
        horizonElapsedMs: Math.round(analysis.stats.elapsedMs),
      },
    });

    const proof = proveForcedWinRigidity(
      data.state,
      data.depth,
      data.winnerTurns,
      data.uniqueWinnerTurns,
      data.maxWinningMoves,
    );
    workerScope.postMessage({
      kind: 'complete',
      token: data.token,
      report: {
        rigid: proof.rigid,
        decisionNodes: proof.decisionNodes,
        defenseBranches: proof.defenseBranches,
        proofNodes: proof.stats.nodes,
        proofCutoffs: proof.stats.cutoffs,
        proofTableHits: proof.stats.tableHits,
        proofElapsedMs: Math.round(proof.stats.elapsedMs),
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
