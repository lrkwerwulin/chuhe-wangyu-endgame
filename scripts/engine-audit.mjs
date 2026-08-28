import assert from 'node:assert/strict';
import {
  MATE_SCORE,
  analyseSurvivalMoves,
  applyMove,
  generateLegalMoves,
  generatePseudoMoves,
  isInCheck,
  moveKey,
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
