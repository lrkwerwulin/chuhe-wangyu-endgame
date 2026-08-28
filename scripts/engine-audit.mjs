import assert from 'node:assert/strict';
import {
  MATE_SCORE,
  analyseForcedWinMoves,
  analyseMoveHorizons,
  analyseSurvivalMoves,
  applyMove,
  generateLegalMoves,
  generatePseudoMoves,
  isInCheck,
  moveKey,
  proveForcedWinRigidity,
  searchForcedOutcome,
  terminalState,
  validateState,
} from '../lib/hybrid-engine.ts';

const piece = (id, side, type, x, y) => ({ id, side, type, x, y });
const base = (extras = [], turn = 'xiangqi', general = [4, 9], king = [0, 0]) => ({
  pieces: [
    piece('x-general', 'xiangqi', 'general', ...general),
    piece('c-king', 'chess', 'king', ...king),
    ...extras,
  ],
  turn,
  ply: 0,
});

const tests = [];
const test = (name, run) => tests.push({ name, run });

function bruteMateOnlyNegamax(state, depth, searchPly = 0) {
  const moves = generateLegalMoves(state);
  if (moves.length === 0) return -MATE_SCORE + searchPly;
  if (depth === 0) return 0;
  let best = -MATE_SCORE;
  for (const move of moves) {
    best = Math.max(best, -bruteMateOnlyNegamax(applyMove(state, move), depth - 1, searchPly + 1));
  }
  return best;
}

test('general and advisor remain inside the south palace', () => {
  const generalState = base([], 'xiangqi', [4, 8]);
  const general = generalState.pieces.find((candidate) => candidate.type === 'general');
  const advisor = piece('a', 'xiangqi', 'advisor', 4, 8);
  const advisorState = base([advisor], 'xiangqi', [4, 9]);
  assert(general);
  assert.equal(generatePseudoMoves(generalState, general).length, 4);
  assert.equal(generatePseudoMoves(advisorState, advisor).length, 4);
});

test('elephant respects the river and blocked eye', () => {
  const elephant = piece('e', 'xiangqi', 'elephant', 4, 7);
  const open = base([elephant]);
  assert.equal(generatePseudoMoves(open, elephant).length, 4);
  const blocked = base([elephant, piece('block', 'xiangqi', 'soldier', 5, 8)]);
  assert.equal(generatePseudoMoves(blocked, elephant).length, 3);
});

test('Xiangqi horse is blocked by its orthogonal leg', () => {
  const horse = piece('h', 'xiangqi', 'horse', 4, 4);
  assert.equal(generatePseudoMoves(base([horse]), horse).length, 8);
  const blocked = base([horse, piece('leg', 'xiangqi', 'soldier', 5, 4)]);
  assert.equal(generatePseudoMoves(blocked, horse).length, 6);
});

test('cannon captures only after exactly one screen', () => {
  const cannon = piece('cannon', 'xiangqi', 'cannon', 4, 4);
  const state = base([
    cannon,
    piece('screen', 'xiangqi', 'soldier', 4, 2),
    piece('target', 'chess', 'rook', 4, 0),
  ], 'xiangqi', [3, 9], [0, 1]);
  const keys = new Set(generatePseudoMoves(state, cannon).map(moveKey));
  assert(keys.has('44-43'));
  assert(keys.has('44-40'));
  assert(!keys.has('44-42'));
  assert(!keys.has('44-41'));
});

test('the general gives a flying check to the western king', () => {
  const state = base([], 'chess', [4, 9], [4, 0]);
  assert.equal(isInCheck(state, 'chess'), true);
  assert.equal(isInCheck(state, 'xiangqi'), false);
});

test('legal move filtering rejects exposure of the general', () => {
  const blocker = piece('blocker', 'xiangqi', 'chariot', 4, 5);
  const state = base([blocker, piece('attacker', 'chess', 'rook', 4, 0)], 'xiangqi', [4, 9], [0, 1]);
  const blockerMoves = generateLegalMoves(state).filter((move) => move.pieceId === blocker.id);
  assert(blockerMoves.length > 0);
  assert(blockerMoves.every((move) => move.to[0] === 4));
});

test('western pawn promotes automatically on the tenth rank', () => {
  const pawn = piece('pawn', 'chess', 'pawn', 4, 8);
  const state = base([pawn], 'chess', [3, 9], [0, 0]);
  const move = generateLegalMoves(state).find((candidate) => candidate.pieceId === pawn.id && candidate.to[1] === 9);
  assert(move);
  assert.equal(move.promotion, 'queen');
  assert.equal(applyMove(state, move).pieces.find((candidate) => candidate.id === pawn.id)?.type, 'queen');
});

test('a trapped royal is a loss in the published hybrid convention', () => {
  const state = base([
    piece('mate-rook', 'chess', 'rook', 4, 8),
    piece('left-rook', 'chess', 'rook', 3, 8),
    piece('right-rook', 'chess', 'rook', 5, 8),
  ], 'xiangqi', [4, 9], [0, 0]);
  const status = terminalState(state);
  assert.equal(status.terminal, true);
  assert.equal(status.loser, 'xiangqi');
  assert.equal(status.kind, 'checkmate');
});

test('mate-only alpha-beta search finds a one-ply finish', () => {
  const state = base([
    piece('mate-rook', 'chess', 'rook', 4, 7),
    piece('left-rook', 'chess', 'rook', 3, 8),
    piece('right-rook', 'chess', 'rook', 5, 8),
  ], 'chess', [4, 9], [0, 0]);
  const result = searchForcedOutcome(state, 1);
  assert(result.score >= MATE_SCORE - 1);
  assert.equal(result.mateMoves, 1);
  assert(result.bestMove);
});

test('state validator catches overlap and illegal Xiangqi zones', () => {
  const state = base([
    piece('bad-advisor', 'xiangqi', 'advisor', 0, 0),
    piece('overlap', 'chess', 'rook', 4, 9),
  ]);
  assert(validateState(state).length >= 2);
});

test('survival classifier returns a complete partition', () => {
  const state = base([
    piece('threat', 'chess', 'rook', 4, 6),
    piece('left-rook', 'chess', 'rook', 3, 7),
    piece('right-rook', 'chess', 'rook', 5, 7),
    piece('guard', 'xiangqi', 'chariot', 4, 8),
  ], 'xiangqi', [4, 9], [0, 0]);
  const analysis = analyseSurvivalMoves(state, 2);
  assert.equal(analysis.safe.length + analysis.losing.length, analysis.legal.length);
  assert(analysis.stats.nodes > 0);
});

test('forced-win classifier proves a unique two-move win', () => {
  const state = base([
    piece('proof-rook', 'chess', 'rook', 3, 0),
    piece('block-left', 'xiangqi', 'soldier', 3, 9),
    piece('block-right', 'xiangqi', 'soldier', 5, 9),
    piece('interposing-elephant', 'xiangqi', 'elephant', 6, 5),
  ], 'chess', [4, 9], [0, 0]);
  const analysis = analyseForcedWinMoves(state, 7);
  assert.equal(analysis.winning.length, 1);
  assert.equal(moveKey(analysis.winning[0].move), '30-40');
  assert.equal(analysis.winning[0].mateMoves, 2);

  const proof = proveForcedWinRigidity(state, 7, 2, 2, 1);
  assert.equal(proof.forcedWin, true);
  assert.equal(proof.rigid, true);
  assert.equal(proof.widestDecision, 1);
  assert.deepEqual(proof.pv.map(moveKey), ['30-40', '65-47', '40-47']);
});

test('per-move horizon classifications match independent minimax', () => {
  const state = base([
    piece('proof-rook', 'chess', 'rook', 3, 0),
    piece('block-left', 'xiangqi', 'soldier', 3, 9),
    piece('block-right', 'xiangqi', 'soldier', 5, 9),
    piece('interposing-elephant', 'xiangqi', 'elephant', 6, 5),
  ], 'chess', [4, 9], [0, 0]);
  const analysis = analyseMoveHorizons(state, 3);
  assert.equal(analysis.horizons[0].unresolved, analysis.legal.length);
  assert.equal(analysis.horizons[1].unresolved, analysis.legal.length);
  assert.equal(analysis.horizons[2].wins, 1);
  assert.equal(analysis.horizons[2].losses, 0);
  for (const verdict of analysis.legal) {
    for (let horizon = 1; horizon <= 3; horizon += 1) {
      const expected = -bruteMateOnlyNegamax(applyMove(state, verdict.move), horizon - 1, 1);
      assert.equal(verdict.horizons[horizon - 1].score, expected, `${moveKey(verdict.move)} at H${horizon}`);
    }
  }
});

test('PVS result matches independent full-width minimax', () => {
  const positions = [
    base([
      piece('mate-rook', 'chess', 'rook', 4, 7),
      piece('left-rook', 'chess', 'rook', 3, 8),
      piece('right-rook', 'chess', 'rook', 5, 8),
    ], 'chess', [4, 9], [0, 0]),
    base([
      piece('proof-rook', 'chess', 'rook', 3, 0),
      piece('block-left', 'xiangqi', 'soldier', 3, 9),
      piece('block-right', 'xiangqi', 'soldier', 5, 9),
      piece('interposing-elephant', 'xiangqi', 'elephant', 6, 5),
    ], 'chess', [4, 9], [0, 0]),
    base([
      piece('threat', 'chess', 'rook', 4, 6),
      piece('guard', 'xiangqi', 'chariot', 4, 8),
    ], 'xiangqi', [4, 9], [0, 0]),
  ];
  for (const state of positions) {
    assert.equal(searchForcedOutcome(state, 3).score, bruteMateOnlyNegamax(state, 3));
  }
});

let passed = 0;
for (const { name, run } of tests) {
  try {
    run();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

console.log(`\n${passed}/${tests.length} hybrid-engine audits passed.`);
