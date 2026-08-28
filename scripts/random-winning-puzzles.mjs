import {
  MATE_SCORE,
  applyMove,
  formatMove,
  generateLegalMoves,
  isInCheck,
  moveKey,
  otherSide,
  proveForcedWinRigidity,
  searchForcedOutcome,
  validateState,
} from '../lib/hybrid-engine.ts';

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
const requested = Math.max(1, Math.min(24, Number(option('count') ?? 8)));
const initialSeed = Number(option('seed') ?? 20260828) >>> 0;
const maxAttempts = Math.max(100, Math.min(100_000, Number(option('attempts') ?? 10_000)));
const proofDepth = Math.max(7, Math.min(13, Number(option('depth') ?? 7)));
const targetMatePlies = Math.max(3, Math.min(5, Number(option('target-mate-plies') ?? 3)));
const minimumDefenseBranches = Math.max(1, Math.min(20, Number(option('min-defense-branches') ?? 1)));
const requestedHuman = ['xiangqi', 'chess'].includes(option('human')) ? option('human') : null;
const requestedMaterial = ['2v4', '3v4', '3v5'].includes(option('material')) ? option('material') : null;

let seed = initialSeed;
const random = () => {
  seed |= 0;
  seed = (seed + 0x6D2B79F5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};
const pick = (items) => items[Math.floor(random() * items.length)];
const p = (id, side, type, x, y) => ({ id, side, type, x, y });

const PALACE = [];
for (let y = 7; y <= 9; y += 1) for (let x = 3; x <= 5; x += 1) PALACE.push([x, y]);
const ADVISOR_SQUARES = [[3, 7], [5, 7], [4, 8], [3, 9], [5, 9]];
const ELEPHANT_SQUARES = [
  [0, 5], [2, 5], [4, 5], [6, 5], [8, 5],
  [0, 7], [2, 7], [4, 7], [6, 7], [8, 7],
  [0, 9], [2, 9], [4, 9], [6, 9], [8, 9],
];
const EDGE_SQUARES = [];
for (let y = 0; y < 10; y += 1) {
  for (let x = 0; x < 9; x += 1) {
    if (x === 0 || x === 8 || y === 0 || y === 9) EDGE_SQUARES.push([x, y]);
  }
}

function occupied(pieces, x, y) {
  return pieces.some((piece) => piece.x === x && piece.y === y);
}

function nearbySquares(origin, radius) {
  const squares = [];
  for (let y = Math.max(0, origin[1] - radius); y <= Math.min(9, origin[1] + radius); y += 1) {
    for (let x = Math.max(0, origin[0] - radius); x <= Math.min(8, origin[0] + radius); x += 1) {
      if (x !== origin[0] || y !== origin[1]) squares.push([x, y]);
    }
  }
  return squares;
}

function legalSquaresFor(type, focus = null) {
  if (type === 'general') return PALACE;
  if (type === 'advisor') return ADVISOR_SQUARES;
  if (type === 'elephant') return ELEPHANT_SQUARES;
  if (type === 'king' && !focus) return EDGE_SQUARES;
  if (focus) return nearbySquares(focus, random() < 0.72 ? 2 : 4);
  const all = [];
  for (let y = 0; y < 10; y += 1) for (let x = 0; x < 9; x += 1) all.push([x, y]);
  return all;
}

function place(pieces, id, side, type, focus = null) {
  const squares = legalSquaresFor(type, focus);
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const [x, y] = pick(squares);
    if (!occupied(pieces, x, y)) {
      pieces.push(p(id, side, type, x, y));
      return true;
    }
  }
  return false;
}

function candidate(material, human) {
  const [humanCount, opponentCount] = material.split('v').map(Number);
  const opponent = otherSide(human);
  const pieces = [];

  if (human === 'xiangqi') {
    const [gx, gy] = pick(PALACE);
    pieces.push(p('x-general', 'xiangqi', 'general', gx, gy));
    const [kx, ky] = pick(EDGE_SQUARES.filter(([x, y]) => Math.abs(x - gx) + Math.abs(y - gy) >= 5));
    pieces.push(p('c-king', 'chess', 'king', kx, ky));
  } else {
    const [gx, gy] = pick(PALACE);
    pieces.push(p('x-general', 'xiangqi', 'general', gx, gy));
    const kingSquare = pick(EDGE_SQUARES.filter(([x, y]) => Math.abs(x - gx) + Math.abs(y - gy) >= 5));
    pieces.push(p('c-king', 'chess', 'king', ...kingSquare));
  }

  const enemyRoyal = pieces.find((piece) => piece.side === opponent && ['general', 'king'].includes(piece.type));
  const ownRoyal = pieces.find((piece) => piece.side === human && ['general', 'king'].includes(piece.type));
  const humanTypes = human === 'xiangqi'
    ? ['chariot', 'cannon', 'chariot', 'horse']
    : ['rook', 'queen', 'rook', 'bishop', 'knight'];
  const opponentTypes = opponent === 'xiangqi'
    ? ['soldier', 'advisor', 'elephant', 'horse', 'cannon', 'chariot']
    : ['pawn', 'knight', 'bishop', 'rook', 'queen'];

  while (pieces.filter((piece) => piece.side === human).length < humanCount) {
    const type = pick(humanTypes);
    const focus = random() < 0.82 ? [enemyRoyal.x, enemyRoyal.y] : [ownRoyal.x, ownRoyal.y];
    if (!place(pieces, `human-${pieces.length}`, human, type, focus)) return null;
  }
  while (pieces.filter((piece) => piece.side === opponent).length < opponentCount) {
    const type = pick(opponentTypes);
    const focus = random() < 0.78 ? [enemyRoyal.x, enemyRoyal.y] : null;
    if (!place(pieces, `opponent-${pieces.length}`, opponent, type, focus)) return null;
  }
  return { turn: human, ply: 0, pieces };
}

function signature(state) {
  return JSON.stringify([...state.pieces]
    .map(({ side, type, x, y }) => [side, type, x, y])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

const materials = requestedMaterial ? [requestedMaterial] : ['2v4', '3v4', '3v5'];
const humans = requestedHuman ? [requestedHuman] : ['xiangqi', 'chess'];
const seen = new Set();
const candidates = [];
let valid = 0;
let searched = 0;
let boundedWins = 0;
let fullProofs = 0;

for (let attempt = 0; attempt < maxAttempts && candidates.length < requested * 3; attempt += 1) {
  const material = pick(materials);
  const human = pick(humans);
  const state = candidate(material, human);
  if (!state || validateState(state).length) continue;
  if (isInCheck(state, otherSide(human))) continue;
  const key = signature(state);
  if (seen.has(key)) continue;
  seen.add(key);
  const legalMoves = generateLegalMoves(state).length;
  if (legalMoves < 4 || legalMoves > 30) continue;
  valid += 1;

  searched += 1;
  const bounded = searchForcedOutcome(state, targetMatePlies);
  if (bounded.score < MATE_SCORE / 2 || bounded.matePlies !== targetMatePlies) continue;
  boundedWins += 1;
  if (!bounded.bestMove) continue;
  const firstDefenseCount = generateLegalMoves(applyMove(state, bounded.bestMove)).length;
  if (firstDefenseCount < minimumDefenseBranches) continue;

  fullProofs += 1;
  const proof = proveForcedWinRigidity(state, proofDepth, 2, 2, 1);
  if (!proof.rigid || proof.matePlies !== targetMatePlies) continue;
  if (proof.defenseBranches < minimumDefenseBranches) continue;

  const principalVariation = [];
  let pvState = { ...state, pieces: state.pieces.map((piece) => ({ ...piece })) };
  for (const move of proof.pv) {
    principalVariation.push(formatMove(pvState, move));
    pvState = applyMove(pvState, move);
  }
  candidates.push({
    material: material.replace('v', ' VS '),
    human,
    proofDepth,
    matePlies: proof.matePlies,
    mateMoves: proof.mateMoves,
    legalMoves,
    winningMoveKeys: proof.rootWinningMoves.map(moveKey),
    winningMoves: proof.rootWinningMoves.map((move) => formatMove(state, move)),
    principalVariation,
    defenseBranches: proof.defenseBranches,
    decisionNodes: proof.decisionNodes,
    nodes: proof.stats.nodes,
    cutoffs: proof.stats.cutoffs,
    tableHits: proof.stats.tableHits,
    pieces: state.pieces,
  });
}

candidates.sort((a, b) => (
  b.defenseBranches - a.defenseBranches
  || b.legalMoves - a.legalMoves
  || a.nodes - b.nodes
));

console.log(JSON.stringify({
  seed: initialSeed,
  requested,
  found: Math.min(requested, candidates.length),
  valid,
  searched,
  boundedWins,
  fullProofs,
  filters: {
    human: requestedHuman ?? 'balanced',
    material: requestedMaterial ?? 'mixed',
    proofDepth,
    targetMatePlies,
    minimumDefenseBranches,
  },
  candidates: candidates.slice(0, requested),
}, null, 2));

if (candidates.length < requested) process.exitCode = 2;
