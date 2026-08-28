import {
  MATE_SCORE,
  analyseForcedWinMoves,
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
const proofDepth = Math.max(7, Math.min(13, Number(option('depth') ?? 9)));
const minimumMatePlies = Math.max(3, Math.min(proofDepth, Number(option('min-mate-plies') ?? 5)));
const winnerTurns = Math.max(2, Math.min(4, Number(option('winner-turns') ?? 3)));
const uniqueWinnerTurns = Math.max(1, Math.min(winnerTurns, Number(option('unique-turns') ?? 2)));
const maxWinningMoves = Math.max(1, Math.min(2, Number(option('max-winning-moves') ?? 2)));
const requestedHuman = ['xiangqi', 'chess'].includes(option('human')) ? option('human') : null;
const requestedMaterial = ['2v4', '3v4', '3v5'].includes(option('material')) ? option('material') : null;

const p = (id, side, type, x, y) => ({ id, side, type, x, y });
const clone = (state) => ({ ...state, ply: 0, pieces: state.pieces.map((piece) => ({ ...piece })) });

function signature(state) {
  return JSON.stringify({
    turn: state.turn,
    pieces: [...state.pieces]
      .map(({ id, side, type, x, y }) => [id, side, type, x, y])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
}

function chessMateThree() {
  return {
    turn: 'chess',
    ply: 0,
    pieces: [
      p('c-king', 'chess', 'king', 0, 0),
      p('c-rook', 'chess', 'rook', 0, 6),
      p('x-general', 'xiangqi', 'general', 4, 9),
      p('x-block-left', 'xiangqi', 'soldier', 3, 9),
      p('x-block-right', 'xiangqi', 'soldier', 5, 9),
      p('x-screen', 'xiangqi', 'soldier', 0, 5),
      p('c-pawn', 'chess', 'pawn', 2, 0),
      p('x-elephant', 'xiangqi', 'elephant', 6, 5),
    ],
  };
}

function xiangqiMateThree() {
  return {
    turn: 'xiangqi',
    ply: 0,
    pieces: [
      p('x-general', 'xiangqi', 'general', 4, 9),
      p('x-chariot', 'xiangqi', 'chariot', 1, 2),
      p('c-king', 'chess', 'king', 0, 1),
      p('c-block-file', 'chess', 'rook', 1, 0),
      p('c-block-diagonal', 'chess', 'knight', 1, 1),
      p('c-screen', 'chess', 'knight', 7, 1),
      p('x-horse', 'xiangqi', 'horse', 1, 3),
      p('c-queen', 'chess', 'queen', 3, 1),
    ],
  };
}

function without(state, ...ids) {
  return { ...clone(state), pieces: state.pieces.filter((piece) => !ids.includes(piece.id)).map((piece) => ({ ...piece })) };
}

const chess35 = chessMateThree();
const xiangqi35 = xiangqiMateThree();
const seeds = [
  { id: 'chess-3v5', material: '3v5', human: 'chess', state: chess35 },
  { id: 'xiangqi-3v5', material: '3v5', human: 'xiangqi', state: xiangqi35 },
  { id: 'chess-3v4', material: '3v4', human: 'chess', state: without(chess35, 'x-screen') },
  { id: 'xiangqi-3v4', material: '3v4', human: 'xiangqi', state: without(xiangqi35, 'c-screen') },
  { id: 'chess-2v4', material: '2v4', human: 'chess', state: without(chess35, 'c-pawn', 'x-screen') },
].filter((item) => (
  (!requestedHuman || item.human === requestedHuman)
  && (!requestedMaterial || item.material === requestedMaterial)
));

if (!seeds.length) throw new Error('No seed matches the requested filters.');

function initialPositionIsReachable(state, human) {
  return !isInCheck(state, otherSide(human));
}

function mutations(source) {
  const results = [];
  for (const piece of source.state.pieces.filter((candidate) => !['general', 'king'].includes(candidate.type))) {
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 9; x += 1) {
        if (x === piece.x && y === piece.y) continue;
        if (source.state.pieces.some((candidate) => candidate.x === x && candidate.y === y)) continue;
        const state = clone(source.state);
        const moved = state.pieces.find((candidate) => candidate.id === piece.id);
        moved.x = x;
        moved.y = y;
        if (validateState(state).length || !initialPositionIsReachable(state, source.human)) continue;
        results.push({
          source: source.id,
          material: source.material,
          human: source.human,
          mutation: `${piece.id}:${piece.x}${piece.y}>${x}${y}`,
          state,
        });
      }
    }
  }
  return results;
}

const seen = new Set(seeds.map((item) => signature(item.state)));
const candidates = [];
let generated = 0;
let searched = 0;
let boundedWins = 0;
let fullProofs = 0;

seedLoop:
for (const seed of seeds) {
  for (const candidate of mutations(seed)) {
    generated += 1;
    const key = signature(candidate.state);
    if (seen.has(key)) continue;
    seen.add(key);
    const legalMoves = generateLegalMoves(candidate.state).length;
    if (legalMoves < 4 || legalMoves > 30) continue;

    searched += 1;
    const bounded = searchForcedOutcome(candidate.state, minimumMatePlies);
    if (bounded.score < MATE_SCORE / 2 || bounded.matePlies === null || bounded.matePlies < minimumMatePlies) continue;
    boundedWins += 1;

    const root = analyseForcedWinMoves(candidate.state, proofDepth);
    if (!root.forcedWin || root.winning.length < 1 || root.winning.length > maxWinningMoves) continue;
    if ((root.best?.matePlies ?? 0) < minimumMatePlies) continue;
    fullProofs += 1;

    const proof = proveForcedWinRigidity(
      candidate.state,
      proofDepth,
      winnerTurns,
      uniqueWinnerTurns,
      maxWinningMoves,
    );
    if (!proof.rigid || (proof.matePlies ?? 0) < minimumMatePlies) continue;

    const principalVariation = [];
    let pvState = clone(candidate.state);
    for (const move of proof.pv) {
      principalVariation.push(formatMove(pvState, move));
      pvState = applyMove(pvState, move);
    }
    const qualityScore = (
      proof.matePlies * 24
      + Math.min(20, legalMoves) * 3
      + Math.min(100, proof.defenseBranches) * 2
      + Math.min(60, proof.decisionNodes)
      - Math.max(0, proof.rootWinningMoves.length - 1) * 15
    );
    candidates.push({
      source: candidate.source,
      mutation: candidate.mutation,
      material: candidate.material.replace('v', ' VS '),
      human: candidate.human,
      proofDepth,
      matePlies: proof.matePlies,
      mateMoves: proof.mateMoves,
      winnerTurns,
      uniqueWinnerTurns,
      widestDecision: proof.widestDecision,
      legalMoves,
      winningMoveKeys: proof.rootWinningMoves.map(moveKey),
      winningMoves: proof.rootWinningMoves.map((move) => formatMove(candidate.state, move)),
      principalVariation,
      defenseBranches: proof.defenseBranches,
      decisionNodes: proof.decisionNodes,
      nodes: proof.stats.nodes,
      cutoffs: proof.stats.cutoffs,
      tableHits: proof.stats.tableHits,
      qualityScore,
      pieces: candidate.state.pieces,
    });
    if (candidates.length >= requested * 3) break seedLoop;
  }
}

candidates.sort((a, b) => (
  b.qualityScore - a.qualityScore
  || b.matePlies - a.matePlies
  || b.defenseBranches - a.defenseBranches
  || a.nodes - b.nodes
));

const selected = [];
const queues = new Map();
for (const candidate of candidates) {
  const key = `${candidate.material}:${candidate.human}`;
  if (!queues.has(key)) queues.set(key, []);
  queues.get(key).push(candidate);
}
while (selected.length < requested && [...queues.values()].some((queue) => queue.length)) {
  for (const queue of queues.values()) {
    if (selected.length >= requested) break;
    const candidate = queue.shift();
    if (candidate) selected.push(candidate);
  }
}

console.log(JSON.stringify({
  requested,
  found: selected.length,
  generated,
  searched,
  boundedWins,
  fullProofs,
  filters: {
    human: requestedHuman ?? 'balanced',
    material: requestedMaterial ?? 'mixed',
    proofDepth,
    minimumMatePlies,
    winnerTurns,
    uniqueWinnerTurns,
    maxWinningMoves,
  },
  candidates: selected,
}, null, 2));

if (selected.length < requested) process.exitCode = 2;
