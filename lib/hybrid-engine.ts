export const BOARD_WIDTH = 9;
export const BOARD_HEIGHT = 10;
export const MATE_SCORE = 100_000;

export type Side = 'xiangqi' | 'chess';
export type XiangqiPiece = 'general' | 'advisor' | 'elephant' | 'horse' | 'chariot' | 'cannon' | 'soldier';
export type ChessPiece = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type PieceType = XiangqiPiece | ChessPiece;

export interface Piece {
  id: string;
  side: Side;
  type: PieceType;
  x: number;
  y: number;
}

export interface GameState {
  pieces: Piece[];
  turn: Side;
  ply: number;
}

export interface Move {
  pieceId: string;
  from: [number, number];
  to: [number, number];
  captureId?: string;
  promotion?: PieceType;
}

export interface SearchStats {
  nodes: number;
  cutoffs: number;
  tableHits: number;
  generatedMoves: number;
  elapsedMs: number;
}

export interface SearchResult {
  score: number;
  bestMove: Move | null;
  pv: Move[];
  matePlies: number | null;
  mateMoves: number | null;
  stats: SearchStats;
}

export interface MoveVerdict {
  move: Move;
  safe: boolean;
  mateIn: number | null;
  reply: Move | null;
  pv: Move[];
  score: number;
}

export interface SurvivalAnalysis {
  legal: MoveVerdict[];
  safe: MoveVerdict[];
  losing: MoveVerdict[];
  horizonMoves: number;
  stats: SearchStats;
}

export interface WinningMoveVerdict {
  move: Move;
  wins: boolean;
  matePlies: number | null;
  mateMoves: number | null;
  pv: Move[];
  score: number;
}

export interface ForcedWinAnalysis {
  forcedWin: boolean;
  depth: number;
  legal: WinningMoveVerdict[];
  winning: WinningMoveVerdict[];
  nonWinning: WinningMoveVerdict[];
  best: WinningMoveVerdict | null;
  stats: SearchStats;
}

export interface ForcedWinRigidity {
  forcedWin: boolean;
  rigid: boolean;
  depth: number;
  matePlies: number | null;
  mateMoves: number | null;
  pv: Move[];
  rootWinningMoves: Move[];
  winnerTurns: number;
  uniqueWinnerTurns: number;
  maxWinningMoves: number;
  decisionNodes: number;
  widestDecision: number;
  defenseBranches: number;
  stats: SearchStats;
}

interface TableEntry {
  depth: number;
  score: number;
  flag: 'exact' | 'lower' | 'upper';
  bestMove: Move | null;
  pv: Move[];
}

interface SearchContext {
  table: Map<string, TableEntry>;
  killers: Map<number, string[]>;
  history: Map<string, number>;
  stats: Omit<SearchStats, 'elapsedMs'>;
}

const ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONAL: ReadonlyArray<readonly [number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ALL_DIRECTIONS = [...ORTHOGONAL, ...DIAGONAL];
const KNIGHT_JUMPS: ReadonlyArray<readonly [number, number]> = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];

const PIECE_VALUE: Record<PieceType, number> = {
  general: 10_000,
  advisor: 220,
  elephant: 250,
  horse: 430,
  chariot: 900,
  cannon: 480,
  soldier: 120,
  king: 10_000,
  queen: 950,
  rook: 540,
  bishop: 340,
  knight: 330,
  pawn: 100,
};

export const PIECE_MARK: Record<PieceType, string> = {
  general: '帅',
  advisor: '仕',
  elephant: '相',
  horse: '马',
  chariot: '车',
  cannon: '炮',
  soldier: '兵',
  king: '♚',
  queen: '♛',
  rook: '♜',
  bishop: '♝',
  knight: '♞',
  pawn: '♟',
};

export function otherSide(side: Side): Side {
  return side === 'xiangqi' ? 'chess' : 'xiangqi';
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT;
}

export function isRoyal(piece: Piece): boolean {
  return piece.type === 'general' || piece.type === 'king';
}

export function pieceAt(state: GameState, x: number, y: number): Piece | undefined {
  return state.pieces.find((piece) => piece.x === x && piece.y === y);
}

function insideXiangqiPalace(x: number, y: number): boolean {
  return x >= 3 && x <= 5 && y >= 7 && y <= 9;
}

function addStepMove(state: GameState, piece: Piece, moves: Move[], x: number, y: number): void {
  if (!inBounds(x, y)) return;
  const target = pieceAt(state, x, y);
  if (target?.side === piece.side || (target && isRoyal(target))) return;
  moves.push({
    pieceId: piece.id,
    from: [piece.x, piece.y],
    to: [x, y],
    captureId: target?.id,
    promotion: piece.type === 'pawn' && y === BOARD_HEIGHT - 1 ? 'queen' : undefined,
  });
}

function addRayMoves(
  state: GameState,
  piece: Piece,
  moves: Move[],
  directions: ReadonlyArray<readonly [number, number]>,
): void {
  for (const [dx, dy] of directions) {
    for (let distance = 1; distance < Math.max(BOARD_WIDTH, BOARD_HEIGHT); distance += 1) {
      const x = piece.x + dx * distance;
      const y = piece.y + dy * distance;
      if (!inBounds(x, y)) break;
      const target = pieceAt(state, x, y);
      if (!target) {
        addStepMove(state, piece, moves, x, y);
        continue;
      }
      if (target.side !== piece.side && !isRoyal(target)) addStepMove(state, piece, moves, x, y);
      break;
    }
  }
}

function addCannonMoves(state: GameState, piece: Piece, moves: Move[]): void {
  for (const [dx, dy] of ORTHOGONAL) {
    let crossedScreen = false;
    for (let distance = 1; distance < Math.max(BOARD_WIDTH, BOARD_HEIGHT); distance += 1) {
      const x = piece.x + dx * distance;
      const y = piece.y + dy * distance;
      if (!inBounds(x, y)) break;
      const target = pieceAt(state, x, y);
      if (!crossedScreen) {
        if (!target) addStepMove(state, piece, moves, x, y);
        else crossedScreen = true;
        continue;
      }
      if (!target) continue;
      if (target.side !== piece.side && !isRoyal(target)) addStepMove(state, piece, moves, x, y);
      break;
    }
  }
}

export function generatePseudoMoves(state: GameState, piece: Piece): Move[] {
  const moves: Move[] = [];
  switch (piece.type) {
    case 'general':
      for (const [dx, dy] of ORTHOGONAL) {
        const x = piece.x + dx;
        const y = piece.y + dy;
        if (insideXiangqiPalace(x, y)) addStepMove(state, piece, moves, x, y);
      }
      break;
    case 'advisor':
      for (const [dx, dy] of DIAGONAL) {
        const x = piece.x + dx;
        const y = piece.y + dy;
        if (insideXiangqiPalace(x, y)) addStepMove(state, piece, moves, x, y);
      }
      break;
    case 'elephant':
      for (const [dx, dy] of DIAGONAL) {
        const eyeX = piece.x + dx;
        const eyeY = piece.y + dy;
        const x = piece.x + dx * 2;
        const y = piece.y + dy * 2;
        if (y >= 5 && inBounds(x, y) && !pieceAt(state, eyeX, eyeY)) addStepMove(state, piece, moves, x, y);
      }
      break;
    case 'horse':
      for (const [dx, dy] of KNIGHT_JUMPS) {
        const legX = piece.x + (Math.abs(dx) === 2 ? Math.sign(dx) : 0);
        const legY = piece.y + (Math.abs(dy) === 2 ? Math.sign(dy) : 0);
        if (!pieceAt(state, legX, legY)) addStepMove(state, piece, moves, piece.x + dx, piece.y + dy);
      }
      break;
    case 'chariot':
    case 'rook':
      addRayMoves(state, piece, moves, ORTHOGONAL);
      break;
    case 'cannon':
      addCannonMoves(state, piece, moves);
      break;
    case 'soldier':
      addStepMove(state, piece, moves, piece.x, piece.y - 1);
      if (piece.y <= 4) {
        addStepMove(state, piece, moves, piece.x - 1, piece.y);
        addStepMove(state, piece, moves, piece.x + 1, piece.y);
      }
      break;
    case 'king':
      for (const [dx, dy] of ALL_DIRECTIONS) addStepMove(state, piece, moves, piece.x + dx, piece.y + dy);
      break;
    case 'queen':
      addRayMoves(state, piece, moves, ALL_DIRECTIONS);
      break;
    case 'bishop':
      addRayMoves(state, piece, moves, DIAGONAL);
      break;
    case 'knight':
      for (const [dx, dy] of KNIGHT_JUMPS) addStepMove(state, piece, moves, piece.x + dx, piece.y + dy);
      break;
    case 'pawn': {
      const y = piece.y + 1;
      if (inBounds(piece.x, y) && !pieceAt(state, piece.x, y)) addStepMove(state, piece, moves, piece.x, y);
      for (const dx of [-1, 1]) {
        const target = pieceAt(state, piece.x + dx, y);
        if (target && target.side !== piece.side && !isRoyal(target)) {
          addStepMove(state, piece, moves, piece.x + dx, y);
        }
      }
      break;
    }
  }
  return moves;
}

function clearRay(state: GameState, fromX: number, fromY: number, toX: number, toY: number): number {
  const dx = Math.sign(toX - fromX);
  const dy = Math.sign(toY - fromY);
  let blockers = 0;
  let x = fromX + dx;
  let y = fromY + dy;
  while (x !== toX || y !== toY) {
    if (pieceAt(state, x, y)) blockers += 1;
    x += dx;
    y += dy;
  }
  return blockers;
}

export function pieceAttacksSquare(state: GameState, piece: Piece, x: number, y: number): boolean {
  const dx = x - piece.x;
  const dy = y - piece.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (dx === 0 && dy === 0) return false;

  switch (piece.type) {
    case 'general': {
      if (absX + absY === 1 && insideXiangqiPalace(x, y)) return true;
      const target = pieceAt(state, x, y);
      return dx === 0 && Boolean(target && isRoyal(target)) && clearRay(state, piece.x, piece.y, x, y) === 0;
    }
    case 'advisor':
      return absX === 1 && absY === 1 && insideXiangqiPalace(x, y);
    case 'elephant':
      return absX === 2 && absY === 2 && y >= 5 && !pieceAt(state, piece.x + dx / 2, piece.y + dy / 2);
    case 'horse': {
      if (!((absX === 2 && absY === 1) || (absX === 1 && absY === 2))) return false;
      const legX = piece.x + (absX === 2 ? Math.sign(dx) : 0);
      const legY = piece.y + (absY === 2 ? Math.sign(dy) : 0);
      return !pieceAt(state, legX, legY);
    }
    case 'chariot':
    case 'rook':
      return (dx === 0 || dy === 0) && clearRay(state, piece.x, piece.y, x, y) === 0;
    case 'cannon':
      return (dx === 0 || dy === 0) && clearRay(state, piece.x, piece.y, x, y) === 1;
    case 'soldier':
      return (dx === 0 && dy === -1) || (piece.y <= 4 && absX === 1 && dy === 0);
    case 'king':
      return absX <= 1 && absY <= 1;
    case 'queen':
      return (dx === 0 || dy === 0 || absX === absY) && clearRay(state, piece.x, piece.y, x, y) === 0;
    case 'bishop':
      return absX === absY && clearRay(state, piece.x, piece.y, x, y) === 0;
    case 'knight':
      return (absX === 2 && absY === 1) || (absX === 1 && absY === 2);
    case 'pawn':
      return absX === 1 && dy === 1;
  }
}

export function isSquareAttacked(state: GameState, x: number, y: number, bySide: Side): boolean {
  return state.pieces.some((piece) => piece.side === bySide && pieceAttacksSquare(state, piece, x, y));
}

export function isInCheck(state: GameState, side: Side): boolean {
  const royal = state.pieces.find((piece) => piece.side === side && isRoyal(piece));
  if (!royal) return true;
  return isSquareAttacked(state, royal.x, royal.y, otherSide(side));
}

export function applyMove(state: GameState, move: Move): GameState {
  const pieces = state.pieces
    .filter((piece) => piece.id !== move.captureId)
    .map((piece) => piece.id === move.pieceId
      ? { ...piece, x: move.to[0], y: move.to[1], type: move.promotion ?? piece.type }
      : piece);
  return { pieces, turn: otherSide(state.turn), ply: state.ply + 1 };
}

export function generateLegalMoves(state: GameState, side: Side = state.turn): Move[] {
  const base = side === state.turn ? state : { ...state, turn: side };
  const moves: Move[] = [];
  for (const piece of base.pieces) {
    if (piece.side !== side) continue;
    for (const move of generatePseudoMoves(base, piece)) {
      const next = applyMove(base, move);
      if (!isInCheck(next, side)) moves.push(move);
    }
  }
  return moves;
}

export function validateState(state: GameState): string[] {
  const errors: string[] = [];
  const occupied = new Set<string>();
  for (const piece of state.pieces) {
    if (!inBounds(piece.x, piece.y)) errors.push(`${piece.id} is outside the board`);
    const square = `${piece.x},${piece.y}`;
    if (occupied.has(square)) errors.push(`multiple pieces occupy ${square}`);
    occupied.add(square);
    if (piece.side === 'xiangqi' && piece.type === 'general' && !insideXiangqiPalace(piece.x, piece.y)) {
      errors.push('the Xiangqi general must remain in the south palace');
    }
    if (piece.side === 'xiangqi' && piece.type === 'advisor' && !insideXiangqiPalace(piece.x, piece.y)) {
      errors.push(`${piece.id} must remain in the south palace`);
    }
    if (piece.side === 'xiangqi' && piece.type === 'elephant' && piece.y < 5) {
      errors.push(`${piece.id} cannot cross the river`);
    }
  }
  const generals = state.pieces.filter((piece) => piece.side === 'xiangqi' && piece.type === 'general');
  const kings = state.pieces.filter((piece) => piece.side === 'chess' && piece.type === 'king');
  if (generals.length !== 1) errors.push('the position must contain exactly one Xiangqi general');
  if (kings.length !== 1) errors.push('the position must contain exactly one chess king');
  if (generals.length === 1 && kings.length === 1 && isInCheck(state, 'xiangqi') && isInCheck(state, 'chess')) {
    errors.push('both royal pieces cannot be in check simultaneously');
  }
  return errors;
}

export function positionKey(state: GameState): string {
  const pieces = [...state.pieces]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((piece) => `${piece.side[0]}:${piece.type}:${piece.x}${piece.y}`)
    .join('|');
  return `${state.turn[0]}|${pieces}`;
}

export function moveKey(move: Move): string {
  return `${move.from[0]}${move.from[1]}-${move.to[0]}${move.to[1]}${move.promotion ? `=${move.promotion}` : ''}`;
}

export function squareName(x: number, y: number): string {
  return `${String.fromCharCode(97 + x)}${BOARD_HEIGHT - y}`;
}

export function formatMove(state: GameState, move: Move): string {
  const piece = state.pieces.find((candidate) => candidate.id === move.pieceId);
  if (!piece) return `${squareName(...move.from)}–${squareName(...move.to)}`;
  return `${PIECE_MARK[piece.type]} ${squareName(...move.from)}${move.captureId ? '×' : '–'}${squareName(...move.to)}${move.promotion ? '=♛' : ''}`;
}

function createSearchContext(): SearchContext {
  return {
    table: new Map(),
    killers: new Map(),
    history: new Map(),
    stats: { nodes: 0, cutoffs: 0, tableHits: 0, generatedMoves: 0 },
  };
}

function isMateScore(score: number): boolean {
  return Math.abs(score) > MATE_SCORE / 2;
}

function mateDistanceFromScore(score: number): number | null {
  return isMateScore(score) ? MATE_SCORE - Math.abs(score) : null;
}

function historyKey(state: GameState, move: Move): string {
  const piece = state.pieces.find((candidate) => candidate.id === move.pieceId);
  return `${state.turn}:${piece?.type ?? move.pieceId}:${moveKey(move)}`;
}

function orderedChildren(
  state: GameState,
  moves: Move[],
  context: SearchContext,
  searchPly: number,
  preferredMove: Move | null = null,
): Array<{ move: Move; child: GameState; priority: number }> {
  const preferredKey = preferredMove ? moveKey(preferredMove) : null;
  const killers = context.killers.get(searchPly) ?? [];
  return moves.map((move) => {
    const captured = move.captureId ? state.pieces.find((piece) => piece.id === move.captureId) : undefined;
    const attacker = state.pieces.find((piece) => piece.id === move.pieceId);
    const child = applyMove(state, move);
    const givesCheck = isInCheck(child, child.turn);
    const key = moveKey(move);
    const capturePriority = captured
      ? 100_000 + PIECE_VALUE[captured.type] * 16 - (attacker ? PIECE_VALUE[attacker.type] : 0)
      : 0;
    const killerIndex = move.captureId ? -1 : killers.indexOf(key);
    const killerPriority = killerIndex === 0 ? 80_000 : killerIndex === 1 ? 70_000 : 0;
    const priority = (
      (preferredKey === key ? 1_000_000 : 0)
      + (givesCheck ? 200_000 : 0)
      + capturePriority
      + (move.promotion ? 90_000 : 0)
      + killerPriority
      + (context.history.get(historyKey(state, move)) ?? 0)
    );
    return { move, child, priority };
  }).sort((a, b) => b.priority - a.priority || moveKey(a.move).localeCompare(moveKey(b.move)));
}

function recordCutoff(state: GameState, move: Move, depth: number, searchPly: number, context: SearchContext): void {
  if (move.captureId || move.promotion) return;
  const key = moveKey(move);
  const killers = context.killers.get(searchPly) ?? [];
  if (killers[0] !== key) context.killers.set(searchPly, [key, killers[0]].filter(Boolean).slice(0, 2));
  const keyForHistory = historyKey(state, move);
  context.history.set(keyForHistory, Math.min(60_000, (context.history.get(keyForHistory) ?? 0) + depth * depth));
}

function negamax(
  state: GameState,
  depth: number,
  alphaInput: number,
  betaInput: number,
  searchPly: number,
  context: SearchContext,
): { score: number; move: Move | null; pv: Move[] } {
  context.stats.nodes += 1;
  const key = `${positionKey(state)}|p${searchPly}`;
  const cached = context.table.get(key);
  let alpha = alphaInput;
  let beta = betaInput;
  if (cached && cached.depth >= depth) {
    context.stats.tableHits += 1;
    if (cached.flag === 'exact') return { score: cached.score, move: cached.bestMove, pv: cached.pv };
    if (cached.flag === 'lower') alpha = Math.max(alpha, cached.score);
    if (cached.flag === 'upper') beta = Math.min(beta, cached.score);
    if (alpha >= beta) return { score: cached.score, move: cached.bestMove, pv: cached.pv };
  }

  const moves = generateLegalMoves(state);
  context.stats.generatedMoves += moves.length;
  if (moves.length === 0) return { score: -MATE_SCORE + searchPly, move: null, pv: [] };
  if (depth === 0) return { score: 0, move: null, pv: [] };

  const originalAlpha = alphaInput;
  const originalBeta = betaInput;
  let bestScore = -MATE_SCORE;
  let bestMove: Move | null = null;
  let bestPv: Move[] = [];
  const children = orderedChildren(state, moves, context, searchPly, cached?.bestMove ?? null);
  for (let index = 0; index < children.length; index += 1) {
    const { move, child } = children[index];
    let reply;
    let score;
    if (index === 0) {
      reply = negamax(child, depth - 1, -beta, -alpha, searchPly + 1, context);
      score = -reply.score;
    } else {
      reply = negamax(child, depth - 1, -alpha - 1, -alpha, searchPly + 1, context);
      score = -reply.score;
      if (score > alpha && score < beta) {
        reply = negamax(child, depth - 1, -beta, -alpha, searchPly + 1, context);
        score = -reply.score;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
      bestPv = [move, ...reply.pv];
    }
    alpha = Math.max(alpha, score);
    if (alpha >= beta) {
      context.stats.cutoffs += 1;
      recordCutoff(state, move, depth, searchPly, context);
      break;
    }
  }

  const flag: TableEntry['flag'] = bestScore <= originalAlpha ? 'upper' : bestScore >= originalBeta ? 'lower' : 'exact';
  if (!cached || depth >= cached.depth || flag === 'exact') {
    context.table.set(key, { depth, score: bestScore, flag, bestMove, pv: bestPv });
  }
  return { score: bestScore, move: bestMove, pv: bestPv };
}

export function searchForcedOutcome(state: GameState, depth: number): SearchResult {
  const started = performance.now();
  const context = createSearchContext();
  let result: { score: number; move: Move | null; pv: Move[] } = { score: 0, move: null, pv: [] };
  for (let currentDepth = 1; currentDepth <= Math.max(1, depth); currentDepth += 1) {
    result = negamax(state, currentDepth, -MATE_SCORE, MATE_SCORE, 0, context);
    if (isMateScore(result.score)) break;
  }
  const matePlies = mateDistanceFromScore(result.score);
  return {
    score: result.score,
    bestMove: result.move,
    pv: result.pv,
    matePlies,
    mateMoves: matePlies === null ? null : Math.ceil(matePlies / 2),
    stats: { ...context.stats, elapsedMs: performance.now() - started },
  };
}

function analyseForcedWinMovesWithContext(
  state: GameState,
  depth: number,
  context: SearchContext,
): Omit<ForcedWinAnalysis, 'stats'> {
  const legalMoves = generateLegalMoves(state);
  context.stats.generatedMoves += legalMoves.length;
  const legal = orderedChildren(state, legalMoves, context, 0).map(({ move, child }): WinningMoveVerdict => {
    const reply = negamax(child, Math.max(0, depth - 1), -MATE_SCORE, MATE_SCORE, 1, context);
    const score = -reply.score;
    const matePlies = score > 0 ? mateDistanceFromScore(score) : null;
    return {
      move,
      wins: matePlies !== null,
      matePlies,
      mateMoves: matePlies === null ? null : Math.ceil(matePlies / 2),
      pv: [move, ...reply.pv],
      score,
    };
  });
  const winning = legal
    .filter((item) => item.wins)
    .sort((a, b) => (a.matePlies ?? Infinity) - (b.matePlies ?? Infinity) || moveKey(a.move).localeCompare(moveKey(b.move)));
  return {
    forcedWin: winning.length > 0,
    depth,
    legal,
    winning,
    nonWinning: legal.filter((item) => !item.wins),
    best: winning[0] ?? null,
  };
}

export function analyseForcedWinMoves(state: GameState, depth = 9): ForcedWinAnalysis {
  const started = performance.now();
  const context = createSearchContext();
  const analysis = analyseForcedWinMovesWithContext(state, Math.max(1, depth), context);
  return {
    ...analysis,
    stats: { ...context.stats, elapsedMs: performance.now() - started },
  };
}

function winnerHasForcedMate(score: number, sideToMove: Side, winner: Side): boolean {
  if (!isMateScore(score)) return false;
  return sideToMove === winner ? score > 0 : score < 0;
}

interface RigidityVisit {
  rigid: boolean;
  decisionNodes: number;
  widestDecision: number;
  defenseBranches: number;
}

export function proveForcedWinRigidity(
  state: GameState,
  depth = 9,
  winnerTurns = 2,
  uniqueWinnerTurns = winnerTurns,
  maxWinningMoves = 1,
): ForcedWinRigidity {
  const started = performance.now();
  const boundedDepth = Math.max(1, depth);
  const boundedWinnerTurns = Math.max(1, winnerTurns);
  const boundedUniqueTurns = Math.max(0, Math.min(boundedWinnerTurns, uniqueWinnerTurns));
  const boundedMaxWinningMoves = Math.max(1, maxWinningMoves);
  const winner = state.turn;
  const context = createSearchContext();
  const root = negamax(state, boundedDepth, -MATE_SCORE, MATE_SCORE, 0, context);
  const matePlies = root.score > 0 ? mateDistanceFromScore(root.score) : null;
  const rootAnalysis = analyseForcedWinMovesWithContext(state, boundedDepth, context);
  const minimumPliesForTurns = boundedWinnerTurns * 2 - 1;
  const memo = new Map<string, RigidityVisit>();

  const visit = (
    current: GameState,
    remainingDepth: number,
    searchPly: number,
    winnerTurnIndex: number,
  ): RigidityVisit => {
    if (winnerTurnIndex >= boundedWinnerTurns) {
      return { rigid: true, decisionNodes: 0, widestDecision: 0, defenseBranches: 0 };
    }
    if (remainingDepth <= 0) {
      return { rigid: false, decisionNodes: 0, widestDecision: 0, defenseBranches: 0 };
    }
    const memoKey = `${positionKey(current)}|d${remainingDepth}|w${winnerTurnIndex}`;
    const memoized = memo.get(memoKey);
    if (memoized) return memoized;

    const moves = generateLegalMoves(current);
    context.stats.generatedMoves += moves.length;
    if (moves.length === 0) {
      const terminal: RigidityVisit = { rigid: false, decisionNodes: 0, widestDecision: 0, defenseBranches: 0 };
      memo.set(memoKey, terminal);
      return terminal;
    }

    const children = orderedChildren(current, moves, context, searchPly);
    const proven = children.map(({ move, child }) => {
      const result = negamax(child, remainingDepth - 1, -MATE_SCORE, MATE_SCORE, searchPly + 1, context);
      return { move, child, result, winnerWins: winnerHasForcedMate(result.score, child.turn, winner) };
    });

    if (current.turn === winner) {
      const winning = proven.filter((item) => item.winnerWins);
      const limit = winnerTurnIndex < boundedUniqueTurns ? 1 : boundedMaxWinningMoves;
      if (winning.length === 0 || winning.length > limit) {
        const failed: RigidityVisit = {
          rigid: false,
          decisionNodes: 1,
          widestDecision: winning.length,
          defenseBranches: 0,
        };
        memo.set(memoKey, failed);
        return failed;
      }

      let selected: RigidityVisit | null = null;
      for (const option of winning) {
        const continuation = visit(option.child, remainingDepth - 1, searchPly + 1, winnerTurnIndex + 1);
        if (continuation.rigid) {
          selected = continuation;
          break;
        }
        selected ??= continuation;
      }
      const result: RigidityVisit = {
        rigid: Boolean(selected?.rigid),
        decisionNodes: 1 + (selected?.decisionNodes ?? 0),
        widestDecision: Math.max(winning.length, selected?.widestDecision ?? 0),
        defenseBranches: selected?.defenseBranches ?? 0,
      };
      memo.set(memoKey, result);
      return result;
    }

    let aggregate: RigidityVisit = { rigid: true, decisionNodes: 0, widestDecision: 0, defenseBranches: proven.length };
    for (const option of proven) {
      if (!option.winnerWins) {
        aggregate = { ...aggregate, rigid: false };
        break;
      }
      const continuation = visit(option.child, remainingDepth - 1, searchPly + 1, winnerTurnIndex);
      aggregate.decisionNodes += continuation.decisionNodes;
      aggregate.widestDecision = Math.max(aggregate.widestDecision, continuation.widestDecision);
      aggregate.defenseBranches += continuation.defenseBranches;
      if (!continuation.rigid) {
        aggregate.rigid = false;
        break;
      }
    }
    memo.set(memoKey, aggregate);
    return aggregate;
  };

  const rootHasLongEnoughMate = matePlies !== null && matePlies >= minimumPliesForTurns;
  const rigidity = rootHasLongEnoughMate
    ? visit(state, boundedDepth, 0, 0)
    : { rigid: false, decisionNodes: 0, widestDecision: rootAnalysis.winning.length, defenseBranches: 0 };

  return {
    forcedWin: matePlies !== null,
    rigid: rootHasLongEnoughMate && rigidity.rigid,
    depth: boundedDepth,
    matePlies,
    mateMoves: matePlies === null ? null : Math.ceil(matePlies / 2),
    pv: root.pv,
    rootWinningMoves: rootAnalysis.winning.map((item) => item.move),
    winnerTurns: boundedWinnerTurns,
    uniqueWinnerTurns: boundedUniqueTurns,
    maxWinningMoves: boundedMaxWinningMoves,
    decisionNodes: rigidity.decisionNodes,
    widestDecision: rigidity.widestDecision,
    defenseBranches: rigidity.defenseBranches,
    stats: { ...context.stats, elapsedMs: performance.now() - started },
  };
}

export function analyseSurvivalMoves(state: GameState, horizonMoves = 4): SurvivalAnalysis {
  const legalMoves = generateLegalMoves(state);
  const depth = Math.max(1, horizonMoves * 2 - 1);
  const totals: SearchStats = { nodes: 0, cutoffs: 0, tableHits: 0, generatedMoves: legalMoves.length, elapsedMs: 0 };
  const legal = legalMoves.map((move): MoveVerdict => {
    const child = applyMove(state, move);
    const result = searchForcedOutcome(child, depth);
    totals.nodes += result.stats.nodes;
    totals.cutoffs += result.stats.cutoffs;
    totals.tableHits += result.stats.tableHits;
    totals.generatedMoves += result.stats.generatedMoves;
    totals.elapsedMs += result.stats.elapsedMs;
    const opponentForcesLoss = result.score >= MATE_SCORE - depth - 1;
    return {
      move,
      safe: !opponentForcesLoss,
      mateIn: opponentForcesLoss ? result.mateMoves : null,
      reply: opponentForcesLoss ? result.bestMove : null,
      pv: result.pv,
      score: result.score,
    };
  });
  return {
    legal,
    safe: legal.filter((item) => item.safe),
    losing: legal.filter((item) => !item.safe),
    horizonMoves,
    stats: totals,
  };
}

export function chooseEngineMove(state: GameState, depth = 7): SearchResult {
  return searchForcedOutcome(state, depth);
}

export function terminalState(state: GameState): { terminal: boolean; loser: Side | null; checked: boolean; kind: 'checkmate' | 'stalemate-loss' | null } {
  const legal = generateLegalMoves(state);
  if (legal.length > 0) return { terminal: false, loser: null, checked: isInCheck(state, state.turn), kind: null };
  const checked = isInCheck(state, state.turn);
  return { terminal: true, loser: state.turn, checked, kind: checked ? 'checkmate' : 'stalemate-loss' };
}
