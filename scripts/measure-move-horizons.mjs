import { analyseMoveHorizons, formatMove, moveKey } from '../lib/hybrid-engine.ts';
import { PUZZLES } from '../lib/puzzles.ts';

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
const requestedId = typeof args.get('puzzle') === 'string' ? args.get('puzzle') : null;
const depthValue = Number(args.get('depth') ?? 7);
const depth = Number.isFinite(depthValue) ? Math.max(1, Math.trunc(depthValue)) : 7;
const includeMoves = args.has('moves') || Boolean(requestedId);
const asJson = args.has('json');
const selected = requestedId ? PUZZLES.filter((puzzle) => puzzle.id === requestedId) : PUZZLES;

if (selected.length === 0) {
  console.error(`Unknown puzzle: ${requestedId}`);
  process.exitCode = 1;
} else {
  const reports = selected.map((puzzle) => {
    const analysis = analyseMoveHorizons(puzzle.state, depth);
    const replyCounts = analysis.legal.map((item) => item.replyCount);
    const replyEdges = replyCounts.reduce((sum, count) => sum + count, 0);
    return {
      id: puzzle.id,
      title: puzzle.title,
      material: puzzle.material,
      legalMoves: analysis.legal.length,
      replyStats: {
        edges: replyEdges,
        min: Math.min(...replyCounts),
        max: Math.max(...replyCounts),
        average: Number((replyEdges / replyCounts.length).toFixed(2)),
      },
      horizons: analysis.horizons.map((item) => ({
        horizon: item.horizon,
        wins: item.wins,
        losses: item.losses,
        unresolved: item.unresolved,
        newlyWins: item.newlyWins,
        newlyLosses: item.newlyLosses,
        searchedMoves: item.searchedMoves,
        nodes: item.stats.nodes,
        cutoffs: item.stats.cutoffs,
        tableHits: item.stats.tableHits,
        generatedMoves: item.stats.generatedMoves,
        elapsedMs: Math.round(item.stats.elapsedMs),
      })),
      moves: analysis.legal.map((item) => ({
        key: moveKey(item.move),
        move: formatMove(puzzle.state, item.move),
        replies: item.replyCount,
        capture: item.capture,
        check: item.givesCheck,
        promotion: item.promotion,
        firstProof: item.firstProvenHorizon,
        final: item.finalOutcome,
        outcomes: item.horizons.map((sample) => sample.outcome),
      })),
      stats: { ...analysis.stats, elapsedMs: Math.round(analysis.stats.elapsedMs) },
    };
  });

  if (asJson) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    for (const report of reports) {
      console.log(`\n${report.id} · ${report.title} · ${report.material} · ${report.legalMoves} legal root moves`);
      console.table(report.horizons.map((item) => ({
        H: item.horizon,
        win: item.wins,
        loss: item.losses,
        unresolved: item.unresolved,
        '+win': item.newlyWins,
        '+loss': item.newlyLosses,
        searched: item.searchedMoves,
        nodes: item.nodes,
        cutoffs: item.cutoffs,
        hits: item.tableHits,
      })));
      console.log(`immediate replies: ${report.replyStats.edges.toLocaleString()} edges · ${report.replyStats.min}–${report.replyStats.max} per root move · ${report.replyStats.average} average`);
      if (includeMoves) {
        console.table(report.moves.map((item) => ({
          key: item.key,
          move: item.move,
          replies: item.replies,
          tactical: [item.capture && 'capture', item.check && 'check', item.promotion && 'promotion'].filter(Boolean).join('+') || 'quiet',
          firstProof: item.firstProof ?? '—',
          final: item.final,
          horizon: item.outcomes.map((outcome) => outcome === 'win' ? 'W' : outcome === 'loss' ? 'L' : '?').join(''),
        })));
      }
      console.log(`total: ${report.stats.nodes.toLocaleString()} nodes · ${report.stats.cutoffs.toLocaleString()} cutoffs · ${report.stats.tableHits.toLocaleString()} table hits · ${report.stats.elapsedMs} ms`);
    }
  }
}
