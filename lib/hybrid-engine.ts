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

interface TableEntry {
  depth: number;
  score: number;
  flag: 'exact' | 'lower' | 'upper';
  bestMove: Move | null;
  pv: Move[];
}

interface SearchContext {
  table: Map<string, TableEntry>;
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

function orderedChildren(state: GameState, moves: Move[]): Array<{ move: Move; child: GameState; priority: number }> {
  return moves.map((move) => {
    const captured = move.captureId ? state.pieces.find((piece) => piece.id === move.captureId) : undefined;
    const child = applyMove(state, move);
    const givesCheck = isInCheck(child, child.turn);
    const priority = (givesCheck ? 20_000 : 0) + (captured ? 10_000 + PIECE_VALUE[captured.type] : 0) + (move.promotion ? 8_000 : 0);
    return { move, child, priority };
  }).sort((a, b) => b.priority - a.priority || moveKey(a.move).localeCompare(moveKey(b.move)));
}

function negamax(
  state: GameState,
  depth: number,
  alphaInput: number,
  beta: number,
  searchPly: number,
  context: SearchContext,
): { score: number; move: Move | null; pv: Move[] } {
  context.stats.nodes += 1;
  const key = `${positionKey(state)}|d${depth}|p${searchPly}`;
  const cached = context.table.get(key);
  let alpha = alphaInput;
  if (cached && cached.depth >= depth) {
    context.stats.tableHits += 1;
    if (cached.flag === 'exact') return { score: cached.score, move: cached.bestMove, pv: cached.pv };
    if (cached.flag === 'lower') alpha = Math.max(alpha, cached.score);
    if (cached.flag === 'upper' && cached.score <= alpha) return { score: cached.score, move: cached.bestMove, pv: cached.pv };
    if (alpha >= beta) return { score: cached.score, move: cached.bestMove, pv: cached.pv };
  }

  const moves = generateLegalMoves(state);
  context.stats.generatedMoves += moves.length;
  if (moves.length === 0) return { score: -MATE_SCORE + searchPly, move: null, pv: [] };
  if (depth === 0) return { score: 0, move: null, pv: [] };

  const originalAlpha = alpha;
  let bestScore = -MATE_SCORE;
  let bestMove: Move | null = null;
  let bestPv: Move[] = [];
  for (const { move, child } of orderedChildren(state, moves)) {
    const reply = negamax(child, depth - 1, -beta, -alpha, searchPly + 1, context);
    const score = -reply.score;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
      bestPv = [move, ...reply.pv];
    }
    alpha = Math.max(alpha, score);
    if (alpha >= beta) {
      context.stats.cutoffs += 1;
      break;
    }
  }

  const flag: TableEntry['flag'] = bestScore <= originalAlpha ? 'upper' : bestScore >= beta ? 'lower' : 'exact';
  context.table.set(key, { depth, score: bestScore, flag, bestMove, pv: bestPv });
  return { score: bestScore, move: bestMove, pv: bestPv };
}

export function searchForcedOutcome(state: GameState, depth: number): SearchResult {
  const started = performance.now();
  const context: SearchContext = {
    table: new Map(),
    stats: { nodes: 0, cutoffs: 0, tableHits: 0, generatedMoves: 0 },
  };
  const result = negamax(state, depth, -MATE_SCORE, MATE_SCORE, 0, context);
  const matePlies = Math.abs(result.score) >= MATE_SCORE - depth - 1 ? MATE_SCORE - Math.abs(result.score) : null;
  return {
    score: result.score,
    bestMove: result.move,
    pv: result.pv,
    matePlies,
    mateMoves: matePlies === null ? null : Math.ceil(matePlies / 2),
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
