import assert from 'node:assert/strict';
import { analyseSurvivalMoves, formatMove, moveKey, terminalState, validateState } from '../lib/hybrid-engine.ts';
import { PUZZLES } from '../lib/puzzles.ts';

const summaries = [];

for (const puzzle of PUZZLES) {
  const errors = validateState(puzzle.state);
  assert.deepEqual(errors, [], `${puzzle.id}: invalid initial state`);
  assert.equal(terminalState(puzzle.state).terminal, false, `${puzzle.id}: starts terminal`);

  const humanCount = puzzle.state.pieces.filter((piece) => piece.side === puzzle.human).length;
  const opponentCount = puzzle.state.pieces.length - humanCount;
  assert.equal(`${humanCount} VS ${opponentCount}`, puzzle.material, `${puzzle.id}: material label mismatch`);

  const analysis = analyseSurvivalMoves(puzzle.state, puzzle.horizonMoves);
  const actualSafe = analysis.safe.map((item) => moveKey(item.move)).sort();
  const expectedSafe = [...puzzle.expectedSafeMoveKeys].sort();
  assert.deepEqual(actualSafe, expectedSafe, `${puzzle.id}: safe-move proof changed`);
  assert(analysis.safe.length >= 1 && analysis.safe.length <= 2, `${puzzle.id}: must expose one or two survival moves`);
  assert(analysis.losing.length >= 1, `${puzzle.id}: needs at least one losing alternative`);
  assert(analysis.losing.every((item) => item.mateIn !== null && item.mateIn <= 4), `${puzzle.id}: an alternative escapes the four-move loss horizon`);

  summaries.push({
    id: puzzle.id,
    material: puzzle.material,
    human: puzzle.human,
    legal: analysis.legal.length,
    safe: analysis.safe.map((item) => formatMove(puzzle.state, item.move)),
    losing: analysis.losing.length,
    slowestLossIn: Math.max(...analysis.losing.map((item) => item.mateIn ?? 0)),
    nodes: analysis.stats.nodes,
    cutoffs: analysis.stats.cutoffs,
    tableHits: analysis.stats.tableHits,
    elapsedMs: Math.round(analysis.stats.elapsedMs),
  });
}

console.table(summaries.map(({ safe, ...summary }) => ({ ...summary, safe: safe.join(' / ') })));
console.log(`\nVerified ${summaries.length} puzzles: exact 1–2 survival moves; every alternative loses within four opponent moves.`);
