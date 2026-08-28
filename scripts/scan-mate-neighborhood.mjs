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
  searchForcedOutcomeLimited,
  validateState,
} from '../lib/hybrid-engine.ts';
import { PUZZLES } from '../lib/puzzles.ts';

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
const sourceId = option('source') ?? 'nine-ply-a-file-knight-net';
const targetMoves = Math.max(5, Math.min(10, Number(option('target-moves') ?? 6)));
const targetPlies = targetMoves * 2 - 1;
const requested = Math.max(1, Math.min(20, Number(option('count') ?? 3)));
const screenBudget = Math.max(10_000, Math.min(5_000_000, Number(option('screen-budget') ?? 140_000)));
const proofBudget = Math.max(screenBudget, Math.min(20_000_000, Number(option('proof-budget') ?? 1_200_000)));
const maxEvaluations = Math.max(10, Math.min(5_000, Number(option('evaluations') ?? 800)));
const maxProofs = Math.max(1, Math.min(1_000, Number(option('proofs') ?? 120)));
const minRootMoves = Math.max(3, Math.min(20, Number(option('min-root-moves') ?? 4)));
const targetRootMoves = Math.max(minRootMoves, Math.min(40, Number(option('target-root-moves') ?? 14)));
const uniqueTurns = Math.max(1, Math.min(targetMoves, Number(option('unique-turns') ?? 2)));
const maxWinningMoves = Math.max(1, Math.min(24, Number(option('max-winning-moves') ?? 3)));
const pieceFilter = new Set((option('pieces') ?? '').split(',').filter(Boolean));
const EXPERIMENTAL_SOURCES = [
  {
    id: 'eleven-ply-rigid-nine-choice-seed',
    mateMoves: 6,
    human: 'chess',
    state: {
      turn: 'chess',
      ply: 0,
      pieces: [
        { id: 'c-king', side: 'chess', type: 'king', x: 0, y: 0 },
        { id: 'c-rook', side: 'chess', type: 'rook', x: 0, y: 9 },
        { id: 'c-knight', side: 'chess', type: 'knight', x: 8, y: 0 },
        { id: 'x-general', side: 'xiangqi', type: 'general', x: 3, y: 7 },
        { id: 'x-block-left', side: 'xiangqi', type: 'soldier', x: 3, y: 9 },
        { id: 'x-block-right', side: 'xiangqi', type: 'soldier', x: 0, y: 8 },
        { id: 'x-screen', side: 'xiangqi', type: 'soldier', x: 3, y: 2 },
      ],
    },
  },
  {
    id: 'eleven-ply-two-rook-seed',
    mateMoves: 6,
    human: 'chess',
    state: {
      turn: 'chess',
      ply: 0,
      pieces: [
        { id: 'c-king', side: 'chess', type: 'king', x: 4, y: 2 },
        { id: 'c-rook', side: 'chess', type: 'rook', x: 0, y: 9 },
        { id: 'c-knight', side: 'chess', type: 'knight', x: 8, y: 0 },
        { id: 'x-general', side: 'xiangqi', type: 'general', x: 3, y: 7 },
        { id: 'x-block-left', side: 'xiangqi', type: 'soldier', x: 3, y: 9 },
        { id: 'x-block-right', side: 'xiangqi', type: 'soldier', x: 5, y: 9 },
        { id: 'x-screen', side: 'xiangqi', type: 'soldier', x: 0, y: 1 },
      ],
    },
  },
  {
    id: 'eleven-ply-two-root-seed',
    mateMoves: 6,
    human: 'chess',
    state: {
      turn: 'chess',
      ply: 0,
      pieces: [
        { id: 'c-king', side: 'chess', type: 'king', x: 0, y: 0 },
        { id: 'c-rook', side: 'chess', type: 'rook', x: 0, y: 9 },
        { id: 'c-knight', side: 'chess', type: 'knight', x: 8, y: 0 },
        { id: 'x-general', side: 'xiangqi', type: 'general', x: 3, y: 7 },
        { id: 'x-block-left', side: 'xiangqi', type: 'soldier', x: 3, y: 9 },
        { id: 'x-block-right', side: 'xiangqi', type: 'soldier', x: 5, y: 9 },
        { id: 'x-screen', side: 'xiangqi', type: 'soldier', x: 0, y: 1 },
      ],
    },
  },
  {
    id: 'eleven-ply-four-root-seed',
    mateMoves: 6,
    human: 'chess',
    state: {
      turn: 'chess',
      ply: 0,
      pieces: [
        { id: 'c-king', side: 'chess', type: 'king', x: 0, y: 0 },
        { id: 'c-rook', side: 'chess', type: 'rook', x: 0, y: 9 },
        { id: 'c-knight', side: 'chess', type: 'knight', x: 8, y: 0 },
        { id: 'x-general', side: 'xiangqi', type: 'general', x: 3, y: 7 },
        { id: 'x-block-left', side: 'xiangqi', type: 'soldier', x: 3, y: 9 },
        { id: 'x-block-right', side: 'xiangqi', type: 'soldier', x: 5, y: 9 },
        { id: 'x-screen', side: 'xiangqi', type: 'soldier', x: 3, y: 2 },
      ],
    },
  },
];
const source = [...PUZZLES, ...EXPERIMENTAL_SOURCES].find((puzzle) => puzzle.id === sourceId);
if (!source) throw new Error(`Unknown source puzzle: ${sourceId}`);
if (source.mateMoves > targetMoves) throw new Error('Target mate distance cannot be shorter than the source distance.');

const clone = (state) => ({ ...state, ply: 0, pieces: state.pieces.map((piece) => ({ ...piece })) });
const occupied = (state, x, y) => state.pieces.some((piece) => piece.x === x && piece.y === y);
const signature = (state) => JSON.stringify({
  turn: state.turn,
  pieces: [...state.pieces]
    .map(({ id, side, type, x, y }) => [id, side, type, x, y])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
});

function labels(state, pv) {
  let current = clone(state);
  return pv.map((move) => {
    const label = formatMove(current, move);
    const legal = generateLegalMoves(current).find((candidate) => moveKey(candidate) === moveKey(move));
    if (!legal) return `${label} (?)`;
    current = applyMove(current, legal);
    return label;
  });
}

const candidates = [];
const seen = new Set([signature(source.state)]);
for (const sourcePiece of source.state.pieces) {
  if (pieceFilter.size && !pieceFilter.has(sourcePiece.id)) continue;
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      if ((sourcePiece.x === x && sourcePiece.y === y) || occupied(source.state, x, y)) continue;
      const state = clone(source.state);
      const piece = state.pieces.find((item) => item.id === sourcePiece.id);
      piece.x = x;
      piece.y = y;
      if (validateState(state).length || isInCheck(state, otherSide(state.turn))) continue;
      const key = signature(state);
      if (seen.has(key)) continue;
      seen.add(key);
      const legalCount = generateLegalMoves(state).length;
      if (legalCount < minRootMoves || legalCount > 40) continue;
      const royal = sourcePiece.type === 'king' || sourcePiece.type === 'general';
      const moverSidePenalty = sourcePiece.side === source.human ? 0 : 8;
      const displacement = Math.max(Math.abs(sourcePiece.x - x), Math.abs(sourcePiece.y - y));
      candidates.push({
        state,
        key,
        legalCount,
        mutation: `${sourcePiece.id}:${sourcePiece.x}${sourcePiece.y}-${x}${y}`,
        heuristic: (royal ? 20 : 0) + moverSidePenalty + Math.abs(targetRootMoves - legalCount) * 2 - displacement,
      });
    }
  }
}
candidates.sort((a, b) => a.heuristic - b.heuristic || a.mutation.localeCompare(b.mutation));
const screened = [];
const exactAtScreen = [];
const selected = candidates.slice(0, maxEvaluations);
console.error(`screen: ${candidates.length} legal relocations, evaluating ${selected.length} at ${screenBudget.toLocaleString()} nodes`);
for (let index = 0; index < selected.length; index += 1) {
  const candidate = selected[index];
  const result = searchForcedOutcomeLimited(candidate.state, targetPlies, screenBudget);
  if (!result.aborted && result.score > MATE_SCORE / 2 && result.matePlies === targetPlies) {
    exactAtScreen.push({ ...candidate, screen: result });
  } else if (result.aborted && result.matePlies === null) {
    screened.push({ ...candidate, screen: result });
  }
  if ((index + 1) % 50 === 0) console.error(`screen: ${index + 1}/${selected.length}, ${exactAtScreen.length} exact, ${screened.length} unresolved`);
}

screened.sort((a, b) => (
  b.screen.completedDepth - a.screen.completedDepth
  || b.screen.stats.tableHits - a.screen.stats.tableHits
  || a.heuristic - b.heuristic
));
const exactScreenQueue = exactAtScreen.slice(0, maxProofs);
const proofQueue = [
  ...exactScreenQueue,
  ...screened.slice(0, Math.max(0, maxProofs - exactScreenQueue.length)),
];
console.error(`proof: ${proofQueue.length} candidates at ${proofBudget.toLocaleString()} nodes`);
const exact = [];
for (let index = 0; index < proofQueue.length; index += 1) {
  const candidate = proofQueue[index];
  const result = candidate.screen.aborted
    ? searchForcedOutcomeLimited(candidate.state, targetPlies, proofBudget)
    : candidate.screen;
  if (!result.aborted && result.score > MATE_SCORE / 2 && result.matePlies === targetPlies) {
    const root = analyseForcedWinMoves(candidate.state, targetPlies);
    const rigidity = root.winning.length === 1
      ? proveForcedWinRigidity(
        candidate.state,
        targetPlies,
        targetMoves,
        uniqueTurns,
        maxWinningMoves,
      )
      : {
        rigid: false,
        widestDecision: root.winning.length,
        decisionNodes: 1,
        defenseBranches: 0,
        stats: root.stats,
        pv: root.best?.pv ?? result.pv,
      };
    exact.push({ candidate, result, root, rigidity });
    console.error(`proof: exact M${targetMoves} ${candidate.mutation}, ${root.winning.length}/${root.legal.length} root wins, rigid=${rigidity.rigid}`);
    if (exact.filter((item) => item.root.winning.length === 1 && item.rigidity.rigid).length >= requested) break;
  }
}

exact.sort((a, b) => (
  Number(b.rigidity.rigid) - Number(a.rigidity.rigid)
  || a.root.winning.length - b.root.winning.length
  || b.root.legal.length - a.root.legal.length
  || a.rigidity.widestDecision - b.rigidity.widestDecision
));
const results = exact.slice(0, Math.max(requested, 12)).map(({ candidate, result, root, rigidity }) => ({
  source: source.id,
  targetMoves,
  targetPlies,
  mutation: candidate.mutation,
  legalMoves: root.legal.length,
  winningMoves: root.winning.length,
  deadlineFailures: root.legal.length - root.winning.length,
  winningMoveKeys: root.winning.map((item) => moveKey(item.move)),
  rigid: rigidity.rigid,
  uniqueTurns,
  maxWinningMoves,
  widestDecision: rigidity.widestDecision,
  decisionNodes: rigidity.decisionNodes,
  defenseBranches: rigidity.defenseBranches,
  nodes: rigidity.stats.nodes,
  screenCompletedDepth: candidate.screen.completedDepth,
  proofSearchNodes: result.stats.nodes,
  principalVariationKeys: rigidity.pv.map(moveKey),
  principalVariation: labels(candidate.state, rigidity.pv),
  pieces: candidate.state.pieces,
}));

console.log(JSON.stringify({
  source: source.id,
  sourceMoves: source.mateMoves,
  targetMoves,
  targetPlies,
  requested,
  search: {
    generated: candidates.length,
    evaluated: selected.length,
    screenBudget,
    unresolvedAfterScreen: screened.length,
    exactAtScreen: exactAtScreen.length,
    proofBudget,
    proofQueue: proofQueue.length,
    exact: exact.length,
    minRootMoves,
    targetRootMoves,
  },
  candidates: results,
}, null, 2));

if (!results.some((item) => item.winningMoves === 1 && item.rigid)) process.exitCode = 2;
