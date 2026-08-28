import {
  analyseForcedWinMoves,
  applyMove,
  formatMove,
  generateLegalMoves,
  isInCheck,
  moveKey,
  otherSide,
  proveForcedWinRigidity,
  validateState,
} from '../lib/hybrid-engine.ts';

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
const requested = Math.max(1, Math.min(24, Number(option('count') ?? 8)));
const initialSeed = Number(option('seed') ?? 20260828) >>> 0;
const maxAttempts = Math.max(100, Math.min(100_000, Number(option('attempts') ?? 12_000)));
const proofDepth = Math.max(5, Math.min(13, Number(option('depth') ?? 9)));
const rewindPlies = Math.max(2, Math.min(8, Number(option('rewind') ?? 4)));
const winnerTurns = Math.max(2, Math.min(4, Number(option('winner-turns') ?? 3)));
const uniqueWinnerTurns = Math.max(1, Math.min(winnerTurns, Number(option('unique-turns') ?? 2)));
const maxWinningMoves = Math.max(1, Math.min(2, Number(option('max-winning-moves') ?? 2)));
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
const clone = (state) => ({ ...state, ply: 0, pieces: state.pieces.map((piece) => ({ ...piece })) });

function signature(state) {
  return JSON.stringify({
    turn: state.turn,
    pieces: [...state.pieces]
      .map(({ id, side, type, x, y }) => [id, side, type, x, y])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
}

function samePosition(left, right) {
  return signature(left) === signature(right);
}

function occupied(pieces, x, y) {
  return pieces.some((piece) => piece.x === x && piece.y === y);
}

const ADVISOR_SQUARES = [[3, 7], [5, 7], [4, 8], [3, 9], [5, 9]];
const ELEPHANT_SQUARES = [
  [0, 5], [2, 5], [4, 5], [6, 5], [8, 5],
  [0, 7], [2, 7], [4, 7], [6, 7], [8, 7],
  [0, 9], [2, 9], [4, 9], [6, 9], [8, 9],
];

function randomExtra(side, id, pieces) {
  const xiangqiTypes = ['soldier', 'horse', 'cannon', 'chariot', 'elephant', 'advisor'];
  const chessTypes = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const type = pick(side === 'xiangqi' ? xiangqiTypes : chessTypes);
    let square;
    if (type === 'advisor') square = pick(ADVISOR_SQUARES);
    else if (type === 'elephant') square = pick(ELEPHANT_SQUARES);
    else square = [Math.floor(random() * 9), Math.floor(random() * 10)];
    const [x, y] = square;
    if (!occupied(pieces, x, y)) return p(id, side, type, x, y);
  }
  return null;
}

function baseMateOne(human) {
  if (human === 'chess') {
    return {
      turn: 'chess',
      ply: 0,
      pieces: [
        p('c-king', 'chess', 'king', 0, 0),
        p('c-rook', 'chess', 'rook', 0, 7),
        p('x-general', 'xiangqi', 'general', 4, 9),
        p('x-block-left', 'xiangqi', 'soldier', 3, 9),
        p('x-block-right', 'xiangqi', 'soldier', 5, 9),
        p('x-screen', 'xiangqi', 'soldier', 0, 5),
      ],
    };
  }
  return {
    turn: 'xiangqi',
    ply: 0,
    pieces: [
      p('x-general', 'xiangqi', 'general', 4, 9),
      p('x-chariot', 'xiangqi', 'chariot', 7, 2),
      p('c-king', 'chess', 'king', 0, 0),
      p('c-block-file', 'chess', 'rook', 1, 0),
      p('c-block-diagonal', 'chess', 'knight', 1, 1),
      p('c-screen', 'chess', 'knight', 7, 1),
    ],
  };
}

function makeMateOneSeed(material, human) {
  const [humanCount, opponentCount] = material.split('v').map(Number);
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const state = clone(baseMateOne(human));
    const opponent = otherSide(human);
    while (state.pieces.filter((piece) => piece.side === human).length < humanCount) {
      const extra = randomExtra(human, `human-extra-${state.pieces.length}`, state.pieces);
      if (!extra) break;
      state.pieces.push(extra);
    }
    while (state.pieces.filter((piece) => piece.side === opponent).length < opponentCount) {
      const extra = randomExtra(opponent, `opponent-extra-${state.pieces.length}`, state.pieces);
      if (!extra) break;
      state.pieces.push(extra);
    }
    if (state.pieces.filter((piece) => piece.side === human).length !== humanCount) continue;
    if (state.pieces.filter((piece) => piece.side === opponent).length !== opponentCount) continue;
    if (validateState(state).length || isInCheck(state, human) || isInCheck(state, opponent)) continue;
    const proof = analyseForcedWinMoves(state, 1);
    if (proof.winning.length === 1 && proof.winning[0].matePlies === 1) return state;
  }
  return null;
}

function knownMateThreeSeeds() {
  return [
    {
      material: '3v5',
      human: 'xiangqi',
      baseMatePlies: 3,
      state: {
        turn: 'xiangqi',
        ply: 0,
        pieces: [
          p('x-general', 'xiangqi', 'general', 4, 9),
          p('x-chariot', 'xiangqi', 'chariot', 1, 2),
          p('c-king', 'chess', 'king', 0, 1),
          p('c-block-file', 'chess', 'rook', 1, 0),
          p('c-block-diagonal', 'chess', 'knight', 1, 1),
          p('c-screen', 'chess', 'knight', 7, 1),
          p('human-extra-6', 'xiangqi', 'horse', 1, 3),
          p('opponent-extra-7', 'chess', 'queen', 3, 1),
        ],
      },
    },
    {
      material: '3v5',
      human: 'chess',
      baseMatePlies: 3,
      state: {
        turn: 'chess',
        ply: 0,
        pieces: [
          p('c-king', 'chess', 'king', 0, 0),
          p('c-rook', 'chess', 'rook', 0, 6),
          p('x-general', 'xiangqi', 'general', 4, 9),
          p('x-block-left', 'xiangqi', 'soldier', 3, 9),
          p('x-block-right', 'xiangqi', 'soldier', 5, 9),
          p('x-screen', 'xiangqi', 'soldier', 0, 5),
          p('human-extra-6', 'chess', 'pawn', 2, 0),
          p('opponent-extra-7', 'xiangqi', 'elephant', 6, 5),
        ],
      },
    },
    {
      material: '3v5',
      human: 'chess',
      baseMatePlies: 3,
      state: {
        turn: 'chess',
        ply: 0,
        pieces: [
          p('c-king', 'chess', 'king', 0, 0),
          p('c-rook', 'chess', 'rook', 0, 6),
          p('x-general', 'xiangqi', 'general', 4, 9),
          p('x-block-left', 'xiangqi', 'soldier', 3, 9),
          p('x-block-right', 'xiangqi', 'soldier', 5, 9),
          p('x-screen', 'xiangqi', 'soldier', 0, 5),
          p('human-extra-6', 'chess', 'pawn', 2, 0),
          p('opponent-extra-7', 'xiangqi', 'elephant', 6, 9),
        ],
      },
    },
  ];
}

const predecessorCache = new Map();

function predecessorStates(child) {
  const cacheKey = signature(child);
  const cached = predecessorCache.get(cacheKey);
  if (cached) return cached.map(({ state, ...rest }) => ({ state: clone(state), ...rest }));

  const mover = otherSide(child.turn);
  const results = [];
  const seen = new Set();
  for (const childPiece of child.pieces.filter((piece) => piece.side === mover)) {
    if (childPiece.type === 'pawn' || childPiece.type === 'soldier') continue;
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 9; x += 1) {
        if (x === childPiece.x && y === childPiece.y) continue;
        if (occupied(child.pieces, x, y)) continue;
        const previous = clone(child);
        previous.turn = mover;
        const movedPiece = previous.pieces.find((piece) => piece.id === childPiece.id);
        movedPiece.x = x;
        movedPiece.y = y;
        if (validateState(previous).length) continue;
        if (isInCheck(previous, otherSide(mover))) continue;
        const legalMoves = generateLegalMoves(previous);
        const forward = legalMoves.find((move) => (
          move.pieceId === childPiece.id
          && move.to[0] === childPiece.x
          && move.to[1] === childPiece.y
          && !move.captureId
          && !move.promotion
        ));
        if (!forward) continue;
        const replayed = applyMove(previous, forward);
        replayed.ply = 0;
        if (!samePosition(replayed, child)) continue;
        const key = signature(previous);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ state: previous, move: forward, legalCount: legalMoves.length });
      }
    }
  }

  predecessorCache.set(cacheKey, results.map(({ state, ...rest }) => ({ state: clone(state), ...rest })));
  return results;
}

function choosePredecessor(current, human) {
  const mover = otherSide(current.turn);
  let options = predecessorStates(current);
  if (mover === human) {
    options = options.filter((item) => item.legalCount >= 3 && item.legalCount <= 28);
  } else {
    const tight = options.filter((item) => item.legalCount <= 4);
    const playable = options.filter((item) => item.legalCount <= 8);
    options = tight.length ? tight : playable.length ? playable : options;
  }
  if (!options.length) return null;
  options.sort((a, b) => {
    const target = mover === human ? 10 : 2;
    return Math.abs(a.legalCount - target) - Math.abs(b.legalCount - target);
  });
  const window = options.slice(0, Math.min(options.length, mover === human ? 36 : 18));
  return pick(window);
}

const materials = requestedMaterial ? [requestedMaterial] : ['2v4', '3v4', '3v5'];
const humans = requestedHuman ? [requestedHuman] : ['xiangqi', 'chess'];
const seedStates = [];
for (const material of materials) {
  for (const human of humans) {
    for (let index = 0; index < 12; index += 1) {
      const state = makeMateOneSeed(material, human);
      if (state) seedStates.push({ material, human, baseMatePlies: 1, state });
    }
  }
}
for (const known of knownMateThreeSeeds()) {
  if (materials.includes(known.material) && humans.includes(known.human)) seedStates.push(known);
}

if (!seedStates.length) throw new Error('Could not construct any unique mate-in-one seed positions.');

const minimumTargetPlies = winnerTurns * 2 - 1;
const eligibleSeeds = seedStates.filter((item) => item.baseMatePlies + rewindPlies >= minimumTargetPlies);
if (!eligibleSeeds.length) throw new Error('No seed can reach the requested number of winner turns with this rewind length.');

const seen = new Set(seedStates.map(({ state }) => signature(state)));
const candidates = [];
let rewound = 0;
let quickProofs = 0;
let fullProofs = 0;

for (let attempt = 0; attempt < maxAttempts && candidates.length < requested * 3; attempt += 1) {
  const source = pick(eligibleSeeds);
  let current = clone(source.state);
  const retroLine = [];
  let failed = false;
  for (let step = 0; step < rewindPlies; step += 1) {
    const predecessor = choosePredecessor(current, source.human);
    if (!predecessor) {
      failed = true;
      break;
    }
    current = predecessor.state;
    retroLine.unshift(moveKey(predecessor.move));
  }
  if (failed || current.turn !== source.human) continue;
  rewound += 1;
  const key = signature(current);
  if (seen.has(key)) continue;
  seen.add(key);
  if (validateState(current).length) continue;
  if (isInCheck(current, otherSide(source.human))) continue;

  const legalCount = generateLegalMoves(current).length;
  if (legalCount < 4 || legalCount > 28) continue;
  const quick = analyseForcedWinMoves(current, source.baseMatePlies + rewindPlies);
  quickProofs += 1;
  if (!quick.forcedWin || quick.winning.length > maxWinningMoves) continue;
  if ((quick.best?.matePlies ?? 0) < winnerTurns * 2 - 1) continue;

  fullProofs += 1;
  const proof = proveForcedWinRigidity(
    current,
    proofDepth,
    winnerTurns,
    uniqueWinnerTurns,
    maxWinningMoves,
  );
  if (!proof.forcedWin || !proof.rigid) continue;
  if (proof.rootWinningMoves.length < 1 || proof.rootWinningMoves.length > maxWinningMoves) continue;

  const pvLabels = [];
  let pvState = clone(current);
  for (const move of proof.pv) {
    pvLabels.push(formatMove(pvState, move));
    pvState = applyMove(pvState, move);
  }
  const qualityScore = (
    proof.matePlies * 20
    + Math.min(20, legalCount) * 3
    + Math.min(80, proof.defenseBranches) * 2
    + Math.min(40, proof.decisionNodes)
    - Math.max(0, proof.rootWinningMoves.length - 1) * 12
  );
  candidates.push({
    material: source.material.replace('v', ' VS '),
    human: source.human,
    proofDepth,
    matePlies: proof.matePlies,
    mateMoves: proof.mateMoves,
    winnerTurns,
    uniqueWinnerTurns,
    widestDecision: proof.widestDecision,
    legalMoves: legalCount,
    winningMoveKeys: proof.rootWinningMoves.map(moveKey),
    winningMoves: proof.rootWinningMoves.map((move) => formatMove(current, move)),
    principalVariation: pvLabels,
    defenseBranches: proof.defenseBranches,
    decisionNodes: proof.decisionNodes,
    nodes: proof.stats.nodes,
    cutoffs: proof.stats.cutoffs,
    tableHits: proof.stats.tableHits,
    qualityScore,
    retroLine,
    pieces: current.pieces,
  });
}

candidates.sort((a, b) => (
  b.qualityScore - a.qualityScore
  || b.matePlies - a.matePlies
  || b.defenseBranches - a.defenseBranches
  || a.nodes - b.nodes
));

const selected = [];
const queues = new Map();
for (const material of materials) {
  for (const human of humans) {
    const key = `${material}:${human}`;
    queues.set(key, candidates.filter((item) => item.material === material.replace('v', ' VS ') && item.human === human));
  }
}
while (selected.length < requested && [...queues.values()].some((queue) => queue.length)) {
  for (const queue of queues.values()) {
    if (selected.length >= requested) break;
    const next = queue.shift();
    if (next && !selected.includes(next)) selected.push(next);
  }
}

console.log(JSON.stringify({
  seed: initialSeed,
  requested,
  found: selected.length,
  attempts: maxAttempts,
  seedPositions: seedStates.length,
  rewound,
  quickProofs,
  fullProofs,
  filters: {
    human: requestedHuman ?? 'balanced',
    material: requestedMaterial ?? 'mixed',
    proofDepth,
    rewindPlies,
    winnerTurns,
    uniqueWinnerTurns,
    maxWinningMoves,
  },
  candidates: selected,
}, null, 2));

if (selected.length < requested) process.exitCode = 2;
