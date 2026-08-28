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
  searchForcedOutcomeLimited,
  validateState,
} from '../lib/hybrid-engine.ts';
import { PUZZLES } from '../lib/puzzles.ts';

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
const targetMoves = Math.max(5, Math.min(10, Number(option('target-moves') ?? 5)));
const targetPlies = targetMoves * 2 - 1;
const requested = Math.max(1, Math.min(12, Number(option('count') ?? 3)));
const beamWidth = Math.max(2, Math.min(80, Number(option('beam') ?? 16)));
const evaluationsPerLayer = Math.max(20, Math.min(5_000, Number(option('evaluations') ?? 320)));
const maxDefensePredecessors = Math.max(1, Math.min(80, Number(option('defense-predecessors') ?? 28)));
const maxHumanPredecessors = Math.max(4, Math.min(160, Number(option('human-predecessors') ?? 56)));
const maxDefenseReplies = Math.max(1, Math.min(16, Number(option('max-defense-replies') ?? 2)));
const minRootMoves = Math.max(3, Math.min(20, Number(option('min-root-moves') ?? 4)));
const maxRootMoves = Math.max(minRootMoves, Math.min(40, Number(option('max-root-moves') ?? 28)));
const choiceWeight = Math.max(0, Math.min(20, Number(option('choice-weight') ?? 4)));
const seedCount = Math.max(1, Math.min(60, Number(option('seed-count') ?? 14)));
const nodeBudget = Math.max(10_000, Math.min(10_000_000, Number(option('node-budget') ?? 350_000)));
const polishGenerations = Math.max(0, Math.min(4, Number(option('polish-generations') ?? 2)));
const polishBeamWidth = Math.max(1, Math.min(24, Number(option('polish-beam') ?? 8)));
const polishEvaluations = Math.max(10, Math.min(2_000, Number(option('polish-evaluations') ?? 140)));
const polishNodeBudget = Math.max(10_000, Math.min(10_000_000, Number(option('polish-node-budget') ?? nodeBudget)));
const uniqueWinnerTurns = Math.max(1, Math.min(targetMoves, Number(option('unique-turns') ?? Math.min(3, targetMoves))));
const maxWinningMoves = Math.max(1, Math.min(24, Number(option('max-winning-moves') ?? 2)));
const initialSeed = Number(option('seed') ?? 20260828) >>> 0;
const requestedSource = option('source') ?? null;
const requestedBase = option('base');
const baseMode = requestedBase === 'long' ? 'long' : requestedBase === 'puzzles' || requestedSource ? 'puzzles' : 'mate1';
const requestedHuman = ['xiangqi', 'chess'].includes(option('human')) ? option('human') : null;
const requestedMaterial = ['2 VS 4', '3 VS 4', '3 VS 5'].includes(option('material')) ? option('material') : null;

let randomState = initialSeed;
const random = () => {
  randomState |= 0;
  randomState = (randomState + 0x6D2B79F5) | 0;
  let value = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

const clone = (state) => ({ ...state, ply: 0, pieces: state.pieces.map((piece) => ({ ...piece })) });
const p = (id, side, type, x, y) => ({ id, side, type, x, y });

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

function occupied(state, x, y) {
  return state.pieces.some((piece) => piece.x === x && piece.y === y);
}

const ADVISOR_SQUARES = [[3, 7], [5, 7], [4, 8], [3, 9], [5, 9]];
const ELEPHANT_SQUARES = [
  [0, 5], [2, 5], [4, 5], [6, 5], [8, 5],
  [0, 7], [2, 7], [4, 7], [6, 7], [8, 7],
  [0, 9], [2, 9], [4, 9], [6, 9], [8, 9],
];

function randomExtra(side, id, pieces) {
  const types = side === 'xiangqi'
    ? ['soldier', 'horse', 'cannon', 'chariot', 'elephant', 'advisor']
    : ['pawn', 'knight', 'bishop', 'rook', 'queen'];
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const type = types[Math.floor(random() * types.length)];
    let square;
    if (type === 'advisor') square = ADVISOR_SQUARES[Math.floor(random() * ADVISOR_SQUARES.length)];
    else if (type === 'elephant') square = ELEPHANT_SQUARES[Math.floor(random() * ELEPHANT_SQUARES.length)];
    else square = [Math.floor(random() * 9), Math.floor(random() * 10)];
    if (!pieces.some((piece) => piece.x === square[0] && piece.y === square[1])) {
      return p(id, side, type, square[0], square[1]);
    }
  }
  return null;
}

const predecessorCache = new Map();

function predecessorStates(child) {
  const cacheKey = signature(child);
  const cached = predecessorCache.get(cacheKey);
  if (cached) return cached;

  const mover = otherSide(child.turn);
  const results = [];
  const seen = new Set();
  for (const childPiece of child.pieces.filter((piece) => piece.side === mover)) {
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 9; x += 1) {
        if ((x === childPiece.x && y === childPiece.y) || occupied(child, x, y)) continue;
        const previous = clone(child);
        previous.turn = mover;
        const moved = previous.pieces.find((piece) => piece.id === childPiece.id);
        moved.x = x;
        moved.y = y;
        if (validateState(previous).length) continue;
        if (isInCheck(previous, otherSide(mover))) continue;

        const legal = generateLegalMoves(previous);
        const forward = legal.find((move) => (
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
        results.push({
          state: previous,
          move: forward,
          legalCount: legal.length,
          moverType: childPiece.type,
          distance: Math.max(Math.abs(x - childPiece.x), Math.abs(y - childPiece.y)),
        });
      }
    }
  }
  results.sort((a, b) => a.legalCount - b.legalCount || a.distance - b.distance || moveKey(a.move).localeCompare(moveKey(b.move)));
  predecessorCache.set(cacheKey, results);
  return results;
}

function featureFor(proposal) {
  const distanceBucket = proposal.human.distance <= 1 ? 1 : proposal.human.distance <= 3 ? 3 : 7;
  return [
    proposal.human.moverType,
    proposal.defense.moverType,
    `b${proposal.defense.legalCount}`,
    proposal.humanCheck ? 'in-check' : proposal.givesCheck ? 'checking' : 'quiet',
    `d${distanceBucket}`,
    `m${Math.min(20, Math.ceil(proposal.human.legalCount / 4) * 4)}`,
  ].join(':');
}

function baseHeuristic(proposal) {
  let score = 0;
  score += proposal.defense.legalCount === 1 ? 220 : 80 / proposal.defense.legalCount;
  if (proposal.humanCheck) score += 180;
  if (proposal.givesCheck) score += 150;
  score += Math.max(0, 90 - Math.abs(12 - proposal.human.legalCount) * 7);
  score += Math.max(0, 30 - proposal.human.distance * 4);
  if (proposal.human.moverType === 'king' || proposal.human.moverType === 'general') score += 25;
  return score;
}

const policy = new Map();
let policyVisits = 0;

function policyValue(proposal) {
  const feature = featureFor(proposal);
  const record = policy.get(feature) ?? { visits: 0, reward: 0 };
  const mean = record.visits ? record.reward / record.visits : 45;
  const exploration = 34 * Math.sqrt(Math.log(policyVisits + 2) / (record.visits + 1));
  return baseHeuristic(proposal) + mean + exploration;
}

function reinforce(proposal, reward) {
  const feature = featureFor(proposal);
  const record = policy.get(feature) ?? { visits: 0, reward: 0 };
  record.visits += 1;
  record.reward += reward;
  policy.set(feature, record);
  policyVisits += 1;
}

function chooseProposal(remaining) {
  if (random() < 0.14) return Math.floor(random() * remaining.length);
  let bestIndex = 0;
  let bestScore = -Infinity;
  for (let index = 0; index < remaining.length; index += 1) {
    const score = policyValue(remaining[index]) + random() * 8;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function samplePredecessors(items, limit, score) {
  const ranked = [...items].sort((a, b) => score(b) - score(a));
  if (ranked.length <= limit) return ranked;
  const deterministic = ranked.slice(0, Math.ceil(limit * 0.72));
  const tail = ranked.slice(deterministic.length);
  while (deterministic.length < limit && tail.length) {
    deterministic.push(tail.splice(Math.floor(random() * tail.length), 1)[0]);
  }
  return deterministic;
}

function buildProposals(node, seen) {
  const proposals = [];
  const defenses = samplePredecessors(
    predecessorStates(node.state).filter((item) => item.legalCount <= maxDefenseReplies),
    maxDefensePredecessors,
    (item) => 200 / item.legalCount - item.distance,
  );
  for (const defense of defenses) {
    const humanOptions = predecessorStates(defense.state).filter((item) => (
      item.legalCount >= minRootMoves && item.legalCount <= maxRootMoves
    ));
    const humans = samplePredecessors(humanOptions, maxHumanPredecessors, (item) => {
      const humanCheck = isInCheck(item.state, node.winner);
      const givesCheck = isInCheck(defense.state, defense.state.turn);
      return (humanCheck ? 180 : 0) + (givesCheck ? 140 : 0) - Math.abs(12 - item.legalCount) * 7 - item.distance;
    });
    for (const human of humans) {
      const key = signature(human.state);
      if (seen.has(key)) continue;
      proposals.push({
        state: human.state,
        key,
        parent: node,
        defense,
        human,
        humanCheck: isInCheck(human.state, node.winner),
        givesCheck: isInCheck(defense.state, defense.state.turn),
      });
    }
  }
  return proposals;
}

function pvLabels(state, pv) {
  const labels = [];
  let current = clone(state);
  for (const move of pv) {
    labels.push(formatMove(current, move));
    current = applyMove(current, move);
  }
  return labels;
}

function relocatedStates(node, focusMoves, mutationSeen) {
  const focusKeys = new Set(focusMoves.map(moveKey));
  const preferredKey = node.pv[0] ? moveKey(node.pv[0]) : null;
  const mutations = [];
  for (const sourcePiece of node.state.pieces) {
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 9; x += 1) {
        if ((sourcePiece.x === x && sourcePiece.y === y) || occupied(node.state, x, y)) continue;
        const state = clone(node.state);
        const piece = state.pieces.find((item) => item.id === sourcePiece.id);
        piece.x = x;
        piece.y = y;
        if (validateState(state).length || isInCheck(state, otherSide(state.turn))) continue;
        const key = signature(state);
        if (mutationSeen.has(key)) continue;
        const legal = generateLegalMoves(state);
        if (legal.length < minRootMoves || legal.length > maxRootMoves) continue;
        const legalKeys = new Set(legal.map(moveKey));
        const survivingFocusMoves = [...focusKeys].filter((move) => legalKeys.has(move)).length;
        const keepsPreferredMove = preferredKey ? legalKeys.has(preferredKey) : false;
        const royalPenalty = sourcePiece.type === 'king' || sourcePiece.type === 'general' ? 14 : 0;
        const displacement = Math.max(Math.abs(sourcePiece.x - x), Math.abs(sourcePiece.y - y));
        mutations.push({
          state,
          key,
          legalCount: legal.length,
          survivingFocusMoves,
          keepsPreferredMove,
          mutation: `${sourcePiece.id}:${sourcePiece.x}${sourcePiece.y}-${x}${y}`,
          heuristic: survivingFocusMoves * 160 + Math.abs(6 - legal.length) * 5 + royalPenalty + displacement,
        });
      }
    }
  }
  mutations.sort((a, b) => (
    a.heuristic - b.heuristic
    || Number(b.keepsPreferredMove) - Number(a.keepsPreferredMove)
    || a.mutation.localeCompare(b.mutation)
  ));
  if (mutations.length <= polishEvaluations) return mutations;
  const selected = mutations.slice(0, Math.ceil(polishEvaluations * 0.8));
  const tail = mutations.slice(selected.length);
  while (selected.length < polishEvaluations && tail.length) {
    selected.push(tail.splice(Math.floor(random() * tail.length), 1)[0]);
  }
  return selected;
}

function polishCandidate(candidate, initialRoot) {
  if (polishGenerations === 0 || initialRoot.winning.length <= 1) return null;
  let frontier = [{
    ...candidate,
    winningCount: initialRoot.winning.length,
    winningMoves: initialRoot.winning.map((item) => item.move),
    mutations: [],
  }];
  const mutationSeen = new Set([signature(candidate.state)]);

  for (let generation = 1; generation <= polishGenerations; generation += 1) {
    const proposalMap = new Map();
    for (const parent of frontier) {
      for (const proposal of relocatedStates(parent, parent.winningMoves, mutationSeen)) {
        if (!proposalMap.has(proposal.key)) proposalMap.set(proposal.key, { ...proposal, parent });
      }
    }
    const proposals = [...proposalMap.values()]
      .sort((a, b) => a.heuristic - b.heuristic)
      .slice(0, polishEvaluations);
    const exact = [];
    console.error(`polish G${generation}: ${proposalMap.size} relocations, evaluating ${proposals.length}`);

    for (const proposal of proposals) {
      mutationSeen.add(proposal.key);
      const result = searchForcedOutcomeLimited(proposal.state, targetPlies, polishNodeBudget);
      if (result.aborted || result.matePlies !== targetPlies || result.score <= MATE_SCORE / 2) continue;
      const root = analyseForcedWinMoves(proposal.state, targetPlies);
      if (!root.forcedWin) continue;
      const node = {
        ...proposal.parent,
        state: clone(proposal.state),
        pv: root.best?.pv ?? result.pv,
        exactNodes: root.stats.nodes,
        rootMoves: root.legal.length,
        winningCount: root.winning.length,
        winningMoves: root.winning.map((item) => item.move),
        mutations: [...proposal.parent.mutations, proposal.mutation],
      };
      exact.push(node);
      if (root.winning.length === 1) {
        const proof = proveForcedWinRigidity(
          node.state,
          targetPlies,
          targetMoves,
          uniqueWinnerTurns,
          maxWinningMoves,
        );
        if (proof.rigid && proof.matePlies === targetPlies) {
          console.error(`polish G${generation}: unique rigid M${targetMoves} found via ${node.mutations.join(', ')}`);
          return node;
        }
      }
    }

    exact.sort((a, b) => (
      a.winningCount - b.winningCount
      || b.rootMoves - a.rootMoves
      || a.exactNodes - b.exactNodes
    ));
    frontier = exact.slice(0, polishBeamWidth);
    console.error(`polish G${generation}: ${exact.length} exact M${targetMoves}, beam ${frontier.length}${frontier[0] ? `, best ${frontier[0].winningCount} winning roots` : ''}`);
    if (!frontier.length) break;
  }
  return null;
}

const puzzleSources = PUZZLES.filter((puzzle) => (
  puzzle.mateMoves === 2
  && (!requestedSource || puzzle.id === requestedSource)
  && (!requestedHuman || puzzle.human === requestedHuman)
  && (!requestedMaterial || puzzle.material === requestedMaterial)
)).map((puzzle) => ({
  id: puzzle.id,
  material: puzzle.material,
  human: puzzle.human,
  matePlies: 3,
  state: puzzle.state,
}));
const mateOneSources = [
  {
    id: 'chess-rook-mate-one',
    material: '2 VS 4',
    human: 'chess',
    matePlies: 1,
    state: {
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
    },
  },
  {
    id: 'xiangqi-rook-mate-one',
    material: '2 VS 4',
    human: 'xiangqi',
    matePlies: 1,
    state: {
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
    },
  },
].filter((source) => (
  (!requestedSource || source.id === requestedSource)
  && (!requestedHuman || source.human === requestedHuman)
  && (!requestedMaterial || source.material === requestedMaterial)
));
const verifiedLongSources = PUZZLES.filter((puzzle) => puzzle.mateMoves >= 5).map((puzzle) => ({
  id: puzzle.id,
  material: puzzle.material,
  human: puzzle.human,
  matePlies: puzzle.mateMoves * 2 - 1,
  state: puzzle.state,
}));
const longMateSources = [
  {
    id: 'a-file-knight-net-m5-wide',
    material: '3 VS 4',
    human: 'chess',
    matePlies: 9,
    state: {
      turn: 'chess',
      ply: 0,
      pieces: [
        p('c-king', 'chess', 'king', 0, 0),
        p('c-rook', 'chess', 'rook', 0, 9),
        p('c-knight', 'chess', 'knight', 0, 3),
        p('x-general', 'xiangqi', 'general', 3, 7),
        p('x-block-left', 'xiangqi', 'soldier', 3, 9),
        p('x-block-right', 'xiangqi', 'soldier', 5, 9),
        p('x-screen', 'xiangqi', 'soldier', 0, 6),
      ],
    },
  },
  ...verifiedLongSources,
].filter((source) => (
  source.matePlies < targetPlies
  && (!requestedSource || source.id === requestedSource)
  && (!requestedHuman || source.human === requestedHuman)
  && (!requestedMaterial || source.material === requestedMaterial)
));
const expandedMateOneSources = [...mateOneSources];
if (baseMode === 'mate1' && !requestedSource) {
  const materials = requestedMaterial ? [requestedMaterial] : ['2 VS 4', '3 VS 4', '3 VS 5'];
  const humans = requestedHuman ? [requestedHuman] : ['xiangqi', 'chess'];
  const baseByHuman = new Map(mateOneSources.map((source) => [source.human, source]));
  const seedSignatures = new Set(expandedMateOneSources.map((source) => signature(source.state)));
  for (const material of materials) {
    for (const human of humans) {
      const base = baseByHuman.get(human);
      if (!base) continue;
      const [humanCount, opponentCount] = material.split(' VS ').map(Number);
      let accepted = 0;
      for (let attempt = 0; attempt < seedCount * 80 && accepted < seedCount; attempt += 1) {
        const state = clone(base.state);
        while (state.pieces.filter((piece) => piece.side === human).length < humanCount) {
          const extra = randomExtra(human, `human-extra-${state.pieces.length}`, state.pieces);
          if (!extra) break;
          state.pieces.push(extra);
        }
        const opponent = otherSide(human);
        while (state.pieces.filter((piece) => piece.side === opponent).length < opponentCount) {
          const extra = randomExtra(opponent, `opponent-extra-${state.pieces.length}`, state.pieces);
          if (!extra) break;
          state.pieces.push(extra);
        }
        if (state.pieces.filter((piece) => piece.side === human).length !== humanCount) continue;
        if (state.pieces.filter((piece) => piece.side === opponent).length !== opponentCount) continue;
        if (validateState(state).length || isInCheck(state, human) || isInCheck(state, opponent)) continue;
        const key = signature(state);
        if (seedSignatures.has(key)) continue;
        const root = analyseForcedWinMoves(state, 1);
        if (root.winning.length !== 1 || root.winning[0].matePlies !== 1) continue;
        seedSignatures.add(key);
        accepted += 1;
        expandedMateOneSources.push({
          id: `${human}-${material.replaceAll(' ', '').toLowerCase()}-mate-one-${accepted}`,
          material,
          human,
          matePlies: 1,
          state,
        });
      }
    }
  }
}
const sources = baseMode === 'puzzles' ? puzzleSources : baseMode === 'long' ? longMateSources : expandedMateOneSources;
if (!sources.length) throw new Error('No verified source matches the requested target and filters.');

let beam = sources.map((source) => ({
  source: source.id,
  material: source.material,
  winner: source.human,
  state: clone(source.state),
  matePlies: source.matePlies,
  pv: [],
  lineage: [],
  exactNodes: 0,
  rootMoves: generateLegalMoves(source.state).length,
}));
for (const source of beam) {
  const proof = searchForcedOutcome(source.state, source.matePlies);
  if (proof.matePlies !== source.matePlies) throw new Error(`${source.source} is not an exact M${(source.matePlies + 1) / 2} seed.`);
}
const seen = new Set(beam.map((item) => signature(item.state)));
const layerReports = [];

for (let nextMatePlies = beam[0].matePlies + 2; nextMatePlies <= targetPlies; nextMatePlies += 2) {
  const proposalMap = new Map();
  for (const node of beam) {
    for (const proposal of buildProposals(node, seen)) {
      if (!proposalMap.has(proposal.key)) proposalMap.set(proposal.key, proposal);
    }
  }
  const remaining = [...proposalMap.values()];
  const successes = [];
  const evaluated = Math.min(evaluationsPerLayer, remaining.length);
  console.error(`layer M${(nextMatePlies + 1) / 2}: ${remaining.length} forced-predecessor proposals, evaluating ${evaluated}`);

  for (let index = 0; index < evaluated; index += 1) {
    const selectedIndex = chooseProposal(remaining);
    const proposal = remaining.splice(selectedIndex, 1)[0];
    seen.add(proposal.key);
    const result = searchForcedOutcomeLimited(proposal.state, nextMatePlies, nodeBudget);
    const exact = !result.aborted && result.score > MATE_SCORE / 2 && result.matePlies === nextMatePlies;
    const reward = exact
      ? 260 + (proposal.humanCheck ? 45 : 0) + (proposal.givesCheck ? 35 : 0) + Math.min(20, proposal.human.legalCount) * choiceWeight
      : (result.matePlies ?? 0) * 12 + result.completedDepth * 2;
    reinforce(proposal, reward);
    if (!exact) continue;
    successes.push({
      source: proposal.parent.source,
      material: proposal.parent.material,
      winner: proposal.parent.winner,
      state: clone(proposal.state),
      matePlies: nextMatePlies,
      pv: result.pv,
      lineage: [
        ...proposal.parent.lineage,
        { human: moveKey(proposal.human.move), defense: moveKey(proposal.defense.move) },
      ],
      exactNodes: result.stats.nodes,
      rootMoves: proposal.human.legalCount,
      humanCheck: proposal.humanCheck,
      givesCheck: proposal.givesCheck,
    });
    if (successes.length >= beamWidth * 3) break;
  }

  successes.sort((a, b) => (
    b.rootMoves - a.rootMoves
    || Number(b.humanCheck) - Number(a.humanCheck)
    || Number(b.givesCheck) - Number(a.givesCheck)
    || a.exactNodes - b.exactNodes
  ));
  const diverse = [];
  const sourceCounts = new Map();
  const maxPerSource = Math.max(4, Math.ceil(beamWidth / Math.max(1, sources.length)));
  for (const item of successes) {
    const count = sourceCounts.get(item.source) ?? 0;
    if (count >= maxPerSource) continue;
    sourceCounts.set(item.source, count + 1);
    diverse.push(item);
    if (diverse.length >= beamWidth) break;
  }
  beam = diverse.length ? diverse : successes.slice(0, beamWidth);
  layerReports.push({
    mateMoves: (nextMatePlies + 1) / 2,
    proposals: proposalMap.size,
    evaluated,
    exactExtensions: successes.length,
    beam: beam.length,
  });
  console.error(`layer M${(nextMatePlies + 1) / 2}: ${successes.length} exact extensions, beam ${beam.length}`);
  if (!beam.length) break;
}

const finalists = [];
const rejectedFinalists = [];
for (const candidate of beam.filter((item) => item.matePlies === targetPlies)) {
  let finalist = candidate;
  let root = analyseForcedWinMoves(finalist.state, targetPlies);
  if (root.forcedWin && root.winning.length > 1) {
    const polished = polishCandidate(finalist, root);
    if (polished) {
      finalist = polished;
      root = analyseForcedWinMoves(finalist.state, targetPlies);
    }
  }
  if (!root.forcedWin || root.winning.length !== 1) {
    rejectedFinalists.push({
      source: candidate.source,
      reason: 'root-shortest-not-unique',
      legalMoves: root.legal.length,
      winningMoves: root.winning.length,
      winningMoveKeys: root.winning.map((item) => moveKey(item.move)),
      principalVariationKeys: finalist.pv.map(moveKey),
      principalVariation: pvLabels(finalist.state, finalist.pv),
      pieces: finalist.state.pieces,
    });
    continue;
  }
  const proof = proveForcedWinRigidity(finalist.state, targetPlies, targetMoves, uniqueWinnerTurns, maxWinningMoves);
  if (!proof.rigid || proof.matePlies !== targetPlies) {
    rejectedFinalists.push({
      source: candidate.source,
      reason: 'continuation-not-rigid',
      winningMoves: root.winning.length,
      widestDecision: proof.widestDecision,
      decisionNodes: proof.decisionNodes,
      defenseBranches: proof.defenseBranches,
    });
    continue;
  }
  finalists.push({
    source: finalist.source,
    material: finalist.material,
    human: finalist.winner,
    proofDepth: targetPlies,
    matePlies: targetPlies,
    mateMoves: targetMoves,
    legalMoves: root.legal.length,
    deadlineFailures: root.legal.length - proof.rootWinningMoves.length,
    winningMoveKeys: proof.rootWinningMoves.map(moveKey),
    winningMoves: proof.rootWinningMoves.map((move) => formatMove(finalist.state, move)),
    principalVariationKeys: proof.pv.map(moveKey),
    principalVariation: pvLabels(finalist.state, proof.pv),
    winnerTurns: targetMoves,
    uniqueWinnerTurns,
    maxWinningMoves,
    nodeBudget,
    decisionNodes: proof.decisionNodes,
    defenseBranches: proof.defenseBranches,
    nodes: proof.stats.nodes,
    cutoffs: proof.stats.cutoffs,
    tableHits: proof.stats.tableHits,
    lineage: finalist.lineage,
    mutations: finalist.mutations ?? [],
    pieces: finalist.state.pieces,
  });
  if (finalists.length >= requested) break;
}

const learnedPolicy = [...policy.entries()]
  .map(([feature, record]) => ({ feature, visits: record.visits, meanReward: Number((record.reward / record.visits).toFixed(2)) }))
  .sort((a, b) => b.meanReward - a.meanReward || b.visits - a.visits)
  .slice(0, 12);

console.log(JSON.stringify({
  seed: initialSeed,
  targetMoves,
  targetPlies,
  requested,
  found: finalists.length,
  sources: sources.map((puzzle) => puzzle.id),
  baseMode,
  search: {
    beamWidth,
    evaluationsPerLayer,
    maxDefensePredecessors,
    maxHumanPredecessors,
    maxDefenseReplies,
    minRootMoves,
    maxRootMoves,
    choiceWeight,
    seedCount,
    uniqueWinnerTurns,
    maxWinningMoves,
    policyVisits,
    polishGenerations,
    polishBeamWidth,
    polishEvaluations,
    polishNodeBudget,
  },
  layers: layerReports,
  learnedPolicy,
  rejectedFinalists,
  candidates: finalists,
}, null, 2));

if (finalists.length < requested) process.exitCode = 2;
