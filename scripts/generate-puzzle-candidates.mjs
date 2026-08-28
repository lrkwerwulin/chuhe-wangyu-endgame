import { analyseSurvivalMoves, moveKey, validateState } from '../lib/hybrid-engine.ts';

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
const requested = Math.max(1, Math.min(12, Number(option('count') ?? 3)));
const initialSeed = Number(option('seed') ?? 20260828) >>> 0;
const requestedHuman = ['xiangqi', 'chess'].includes(option('human')) ? option('human') : null;
const requestedMaterial = ['2v4', '3v4', '3v5'].includes(option('material')) ? option('material') : null;
const maxAttempts = Math.max(40, Math.min(600, Number(option('attempts') ?? 240)));
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

const xiangqiBase = () => ({
  human: 'xiangqi',
  pieces: [
    p('x-general', 'xiangqi', 'general', 4, 9),
    p('x-chariot', 'xiangqi', 'chariot', 4, 8),
    p('c-king', 'chess', 'king', 0, 0),
    p('c-rook', 'chess', 'rook', 4, 6),
    p('c-knight-left', 'chess', 'knight', 1, 8),
    p('c-knight-right', 'chess', 'knight', 7, 8),
  ],
});

const chessBase = () => ({
  human: 'chess',
  pieces: [
    p('c-king', 'chess', 'king', 4, 0),
    p('c-rook', 'chess', 'rook', 4, 1),
    p('x-general', 'xiangqi', 'general', 4, 9),
    p('x-chariot-center', 'xiangqi', 'chariot', 4, 3),
    p('x-chariot-left', 'xiangqi', 'chariot', 3, 2),
    p('x-chariot-right', 'xiangqi', 'chariot', 5, 2),
  ],
});

const occupied = (pieces, x, y) => pieces.some((piece) => piece.x === x && piece.y === y);

function randomExtra(side, id, pieces) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    let type;
    let x;
    let y;
    if (side === 'xiangqi') {
      type = pick(['soldier', 'horse', 'elephant', 'advisor', 'cannon']);
      if (type === 'advisor') {
        [x, y] = pick([[3, 7], [5, 7], [4, 8], [3, 9], [5, 9]]);
      } else if (type === 'elephant') {
        [x, y] = pick([[0, 5], [2, 5], [4, 5], [6, 5], [8, 5], [0, 9], [2, 9], [6, 9], [8, 9]]);
      } else {
        x = Math.floor(random() * 9);
        y = 5 + Math.floor(random() * 5);
      }
    } else {
      type = pick(['pawn', 'knight', 'bishop']);
      x = Math.floor(random() * 9);
      y = Math.floor(random() * 4);
    }
    if (!occupied(pieces, x, y)) return p(id, side, type, x, y);
  }
  return null;
}

function candidate(material, human) {
  const base = human === 'xiangqi' ? xiangqiBase() : chessBase();
  const [humanCount, opponentCount] = material.split('v').map(Number);
  const pieces = [...base.pieces];
  while (pieces.filter((piece) => piece.side === human).length < humanCount) {
    const extra = randomExtra(human, `human-extra-${pieces.length}`, pieces);
    if (!extra) return null;
    pieces.push(extra);
  }
  const opponent = human === 'xiangqi' ? 'chess' : 'xiangqi';
  while (pieces.filter((piece) => piece.side === opponent).length < opponentCount) {
    const extra = randomExtra(opponent, `opponent-extra-${pieces.length}`, pieces);
    if (!extra) return null;
    pieces.push(extra);
  }
  return { turn: human, ply: 0, pieces };
}

const signatures = new Set();
const pool = [];
const poolTarget = Math.min(24, Math.max(requested, requested * 2));
let attempts = 0;
for (; attempts < maxAttempts && pool.length < poolTarget; attempts += 1) {
  const material = requestedMaterial ?? pick(['2v4', '3v4', '3v5']);
  const human = requestedHuman ?? pick(['xiangqi', 'chess']);
  const state = candidate(material, human);
  if (!state || validateState(state).length > 0) continue;
  const signature = JSON.stringify(state.pieces.map(({ side, type, x, y }) => [side, type, x, y]));
  if (signatures.has(signature)) continue;
  signatures.add(signature);

  const quick = analyseSurvivalMoves(state, 2);
  if (quick.safe.length < 1 || quick.safe.length > 2 || quick.losing.length < 1) continue;
  const proof = analyseSurvivalMoves(state, 4);
  if (proof.safe.length < 1 || proof.safe.length > 2 || proof.losing.length < 1) continue;
  if (!proof.losing.every((item) => item.mateIn !== null && item.mateIn <= 4)) continue;

  const deepestRefutation = Math.max(...proof.losing.map((item) => item.mateIn ?? 0));
  const safePieceCount = new Set(proof.safe.map((item) => item.move.pieceId)).size;
  const qualityScore = (
    Math.min(12, proof.legal.length) * 4
    + deepestRefutation * 5
    + (proof.safe.length === 1 ? 12 : 8)
    + safePieceCount * 3
    + (material === '3v5' ? 4 : material === '3v4' ? 2 : 0)
  );

  pool.push({
    material: material.replace('v', ' VS '),
    human,
    safeMoveKeys: proof.safe.map((item) => moveKey(item.move)),
    legalMoves: proof.legal.length,
    deepestRefutation,
    qualityScore,
    nodes: proof.stats.nodes,
    cutoffs: proof.stats.cutoffs,
    pieces: state.pieces,
  });
}

pool.sort((a, b) => b.qualityScore - a.qualityScore || b.legalMoves - a.legalMoves || a.nodes - b.nodes);
const candidates = [];
if (requestedHuman) {
  candidates.push(...pool.slice(0, requested));
} else {
  const bySide = {
    xiangqi: pool.filter((item) => item.human === 'xiangqi'),
    chess: pool.filter((item) => item.human === 'chess'),
  };
  while (candidates.length < requested && (bySide.xiangqi.length || bySide.chess.length)) {
    const preferred = candidates.length % 2 === 0 ? 'xiangqi' : 'chess';
    const fallback = preferred === 'xiangqi' ? 'chess' : 'xiangqi';
    candidates.push((bySide[preferred].shift() ?? bySide[fallback].shift()));
  }
}

console.log(JSON.stringify({
  seed: initialSeed,
  requested,
  found: candidates.length,
  attempts,
  poolSize: pool.length,
  filters: { human: requestedHuman ?? 'balanced', material: requestedMaterial ?? 'mixed' },
  candidates,
}, null, 2));
if (candidates.length < requested) process.exitCode = 2;
