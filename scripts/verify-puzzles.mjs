import assert from 'node:assert/strict';
import {
  analyseForcedWinMoves,
  applyMove,
  formatMove,
  generateLegalMoves,
  moveKey,
  otherSide,
  proveForcedWinRigidity,
  terminalState,
  validateState,
} from '../lib/hybrid-engine.ts';
import { PUZZLES } from '../lib/puzzles.ts';

const summaries = [];

for (const puzzle of PUZZLES) {
  const errors = validateState(puzzle.state);
  assert.deepEqual(errors, [], `${puzzle.id}: invalid initial state`);
  assert.equal(terminalState(puzzle.state).terminal, false, `${puzzle.id}: starts terminal`);

  const humanCount = puzzle.state.pieces.filter((piece) => piece.side === puzzle.human).length;
  const opponentCount = puzzle.state.pieces.length - humanCount;
  assert.equal(`${humanCount} VS ${opponentCount}`, puzzle.material, `${puzzle.id}: material label mismatch`);

  const analysis = analyseForcedWinMoves(puzzle.state, puzzle.proofDepth);
  const actualWinning = analysis.winning.map((item) => moveKey(item.move)).sort();
  const expectedWinning = [...puzzle.expectedWinningMoveKeys].sort();
  assert.deepEqual(actualWinning, expectedWinning, `${puzzle.id}: root winning-move proof changed`);
  assert.equal(analysis.forcedWin, true, `${puzzle.id}: side to move no longer has a forced win`);
  assert.equal(analysis.best?.mateMoves, puzzle.mateMoves, `${puzzle.id}: mate distance changed`);

  const proof = proveForcedWinRigidity(
    puzzle.state,
    puzzle.proofDepth,
    puzzle.winnerTurns,
    puzzle.uniqueWinnerTurns,
    1,
  );
  assert.equal(proof.forcedWin, true, `${puzzle.id}: bounded forced-win proof failed`);
  assert.equal(proof.rigid, true, `${puzzle.id}: winner's early decisions are no longer unique across every defense`);
  assert.equal(proof.widestDecision, 1, `${puzzle.id}: a checked winner node exposes multiple winning moves`);
  assert.equal(proof.mateMoves, puzzle.mateMoves, `${puzzle.id}: rigidity proof mate distance changed`);

  const actualPv = proof.pv.map(moveKey);
  assert.deepEqual(actualPv, puzzle.expectedPrincipalVariationKeys, `${puzzle.id}: principal defense line changed`);
  let pvState = puzzle.state;
  const pvLabels = [];
  for (const expectedMoveKey of puzzle.expectedPrincipalVariationKeys) {
    const move = generateLegalMoves(pvState).find((candidate) => moveKey(candidate) === expectedMoveKey);
    assert(move, `${puzzle.id}: stored principal move ${expectedMoveKey} is illegal`);
    pvLabels.push(formatMove(pvState, move));
    pvState = applyMove(pvState, move);
  }
  const terminal = terminalState(pvState);
  assert.equal(terminal.terminal, true, `${puzzle.id}: principal line does not end the game`);
  assert.equal(terminal.loser, otherSide(puzzle.human), `${puzzle.id}: principal line has the wrong winner`);

  summaries.push({
    id: puzzle.id,
    material: puzzle.material,
    human: puzzle.human,
    legal: analysis.legal.length,
    winning: actualWinning.length,
    mate: `M${proof.mateMoves}`,
    rigidTurns: `${puzzle.uniqueWinnerTurns}/${puzzle.winnerTurns}`,
    decisionNodes: proof.decisionNodes,
    defenseBranches: proof.defenseBranches,
    nodes: analysis.stats.nodes + proof.stats.nodes,
    cutoffs: analysis.stats.cutoffs + proof.stats.cutoffs,
    tableHits: analysis.stats.tableHits + proof.stats.tableHits,
    elapsedMs: Math.round(analysis.stats.elapsedMs + proof.stats.elapsedMs),
    pv: pvLabels.join(' / '),
  });
}

console.table(summaries);
console.log(`\nVerified ${summaries.length} puzzles: forced M2 wins; the winner has exactly one winning move at both of its first two turns across every defense branch.`);
