import {
  analyseSurvivalMoves,
  formatMove,
  generateLegalMoves,
  moveKey,
  validateState,
} from '../lib/hybrid-engine.ts';
import { PUZZLES } from '../lib/puzzles.ts';

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
const requested = Math.max(1, Math.min(12, Number(option('count') ?? 6)));
const initialSeed = Number(option('seed') ?? 20260830) >>> 0;
const maxAttempts = Math.max(100, Math.min(5000, Number(option('attempts') ?? 1400)));
const maxProofs = Math.max(requested, Math.min(180, Number(option('proofs') ?? 90)));
let seed = initialSeed;

const random = () => {
  seed |= 0;
  seed = (seed + 0x6D2B79F5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};
const pick = (items) => items[Math.floor(random() * items.length)];
const clone = (state) => ({ ...state, ply: 0, pieces: state.pieces.map((piece) => ({ ...piece })) });

const XIANGQI_TYPES = ['advisor', 'elephant', 'horse', 'chariot', 'cannon', 'soldier'];
const CHESS_TYPES = ['queen', 'rook', 'bishop', 'knight', 'pawn'];
const ADVISOR_SQUARES = [[3, 7], [5, 7], [4, 8], [3, 9], [5, 9]];

function legalSquare(piece) {
  if (piece.side === 'xiangqi' && piece.type === 'general') {
    return [3 + Math.floor(random() * 3), 7 + Math.floor(random() * 3)];
  }
  if (piece.side === 'xiangqi' && piece.type === 'advisor') return [...pick(ADVISOR_SQUARES)];
  if (piece.side === 'xiangqi' && piece.type === 'elephant') {
    return [Math.floor(random() * 9), 5 + Math.floor(random() * 5)];
  }
  return [Math.floor(random() * 9), Math.floor(random() * 10)];
}

function localSquare(piece) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const radius = random() < 0.78 ? 2 : 4;
    const x = piece.x + Math.floor(random() * (radius * 2 + 1)) - radius;
    const y = piece.y + Math.floor(random() * (radius * 2 + 1)) - radius;
    if (x < 0 || x > 8 || y < 0 || y > 9) continue;
    if (x === piece.x && y === piece.y) continue;
    if (piece.side === 'xiangqi' && piece.type === 'general' && !(x >= 3 && x <= 5 && y >= 7)) continue;
    if (piece.side === 'xiangqi' && piece.type === 'advisor' && !ADVISOR_SQUARES.some(([ax, ay]) => ax === x && ay === y)) continue;
    if (piece.side === 'xiangqi' && piece.type === 'elephant' && y < 5) continue;
    return [x, y];
  }
  return legalSquare(piece);
}

function signature(state) {
  return JSON.stringify([...state.pieces]
    .map(({ side, type, x, y }) => [side, type, x, y])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

function mutate(source) {
  const state = clone(source.state);
  const changes = [];
  const mutationCount = random() < 0.62 ? 1 : random() < 0.88 ? 2 : 3;
  for (let step = 0; step < mutationCount; step += 1) {
    const movable = state.pieces.filter((piece) => !['general', 'king'].includes(piece.type));
    const piece = pick(random() < 0.12 ? state.pieces : movable);
    if (!piece) return null;

    if (!['general', 'king'].includes(piece.type) && random() < 0.24) {
      const types = piece.side === 'xiangqi' ? XIANGQI_TYPES : CHESS_TYPES;
      const previous = piece.type;
      piece.type = pick(types.filter((type) => type !== previous));
      const [x, y] = legalSquare(piece);
      piece.x = x;
      piece.y = y;
      changes.push(`${piece.id}:${previous}>${piece.type}@${x}${y}`);
    } else {
      const previous = `${piece.x}${piece.y}`;
      const [x, y] = localSquare(piece);
      piece.x = x;
      piece.y = y;
      changes.push(`${piece.id}:${previous}>${x}${y}`);
    }
  }
  return { state, changes };
}

const seen = new Set(PUZZLES.map((puzzle) => signature(puzzle.state)));
const pool = [];
let proofs = 0;
let attempts = 0;
for (; attempts < maxAttempts && proofs < maxProofs && pool.length < requested * 3; attempts += 1) {
  const source = pick(PUZZLES);
  const evolved = mutate(source);
  if (!evolved || validateState(evolved.state).length) continue;
  const key = signature(evolved.state);
  if (seen.has(key)) continue;
  seen.add(key);

  const legalCount = generateLegalMoves(evolved.state).length;
  if (legalCount < 3 || legalCount > 16) continue;
  const quick = analyseSurvivalMoves(evolved.state, 2);
  if (quick.safe.length < 1 || quick.safe.length > 2 || quick.losing.length < 2) continue;

  proofs += 1;
  const proof = analyseSurvivalMoves(evolved.state, 4);
  if (proof.safe.length < 1 || proof.safe.length > 2 || proof.losing.length < 2) continue;
  if (!proof.losing.every((item) => item.mateIn !== null && item.mateIn <= 4)) continue;

  const deepestRefutation = Math.max(...proof.losing.map((item) => item.mateIn ?? 0));
  const safePieceCount = new Set(proof.safe.map((item) => item.move.pieceId)).size;
  const quietSolutions = proof.safe.filter((item) => !item.move.captureId).length;
  const material = `${evolved.state.pieces.filter((piece) => piece.side === source.human).length} VS ${evolved.state.pieces.filter((piece) => piece.side !== source.human).length}`;
  const qualityScore = (
    Math.min(12, proof.legal.length) * 4
    + deepestRefutation * 6
    + (proof.safe.length === 1 ? 11 : 8)
    + safePieceCount * 4
    + quietSolutions * 3
    + Math.min(3, evolved.changes.length) * 2
  );

  pool.push({
    sourcePuzzle: source.id,
    material,
    human: source.human,
    mutations: evolved.changes,
    legalMoves: proof.legal.length,
    safeMoveKeys: proof.safe.map((item) => moveKey(item.move)),
    safeMoves: proof.safe.map((item) => formatMove(evolved.state, item.move)),
    deepestRefutation,
    qualityScore,
    nodes: proof.stats.nodes,
    cutoffs: proof.stats.cutoffs,
    pieces: evolved.state.pieces,
  });
}

pool.sort((a, b) => b.qualityScore - a.qualityScore || b.deepestRefutation - a.deepestRefutation || a.nodes - b.nodes);
const candidates = [];
const sideQueues = {
  xiangqi: pool.filter((item) => item.human === 'xiangqi'),
  chess: pool.filter((item) => item.human === 'chess'),
};
while (candidates.length < requested && (sideQueues.xiangqi.length || sideQueues.chess.length)) {
  const preferred = candidates.length % 2 === 0 ? 'xiangqi' : 'chess';
  const fallback = preferred === 'xiangqi' ? 'chess' : 'xiangqi';
  candidates.push(sideQueues[preferred].shift() ?? sideQueues[fallback].shift());
}

console.log(JSON.stringify({
  seed: initialSeed,
  requested,
  found: candidates.length,
  attempts,
  proofs,
  poolSize: pool.length,
  candidates,
}, null, 2));
if (candidates.length < requested) process.exitCode = 2;
