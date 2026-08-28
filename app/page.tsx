'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMove,
  formatMove,
  generateLegalMoves,
  isInCheck,
  moveKey,
  pieceAt,
  PIECE_MARK,
  proveForcedWinRigidity,
  searchForcedOutcome,
  squareName,
  type GameState,
  type Move,
} from '@/lib/hybrid-engine';
import { PUZZLES, type Puzzle } from '@/lib/puzzles';

type PlayStatus = 'ready' | 'thinking' | 'correct' | 'wrong';
type Panel = 'rules' | 'research' | null;

interface Verification {
  legal: number;
  winning: number;
  mateMoves: number | null;
  rigid: boolean;
  decisionNodes: number;
  defenseBranches: number;
  nodes: number;
  cutoffs: number;
  tableHits: number;
  elapsedMs: number;
}

const cloneState = (state: GameState): GameState => ({ ...state, pieces: state.pieces.map((piece) => ({ ...piece })) });

function factionName(side: Puzzle['human']): string {
  return side === 'xiangqi' ? '中国象棋' : '国际象棋';
}

function buildPv(start: GameState, pv: Move[]): string[] {
  let state = start;
  return pv.map((move) => {
    const label = formatMove(state, move);
    state = applyMove(state, move);
    return label;
  });
}

export default function Home() {
  const actionToken = useRef(0);
  const verificationToken = useRef(0);
  const [puzzleIndex, setPuzzleIndex] = useState(0);
  const puzzle = PUZZLES[puzzleIndex];
  const [state, setState] = useState<GameState>(() => cloneState(PUZZLES[0].state));
  const [selected, setSelected] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [solutionPly, setSolutionPly] = useState(0);
  const [status, setStatus] = useState<PlayStatus>('ready');
  const [notice, setNotice] = useState('找到第一步唯一胜着，并把 M2 强制胜法走到底。');
  const [proof, setProof] = useState<string[]>([]);
  const [showHint, setShowHint] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<Verification | null>(null);

  const legalMoves = useMemo(() => generateLegalMoves(state), [state]);
  const selectedMoves = useMemo(
    () => selected ? legalMoves.filter((move) => move.pieceId === selected) : [],
    [legalMoves, selected],
  );
  const inCheck = isInCheck(state, state.turn);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  function loadPuzzle(index: number): void {
    actionToken.current += 1;
    verificationToken.current += 1;
    const nextIndex = (index + PUZZLES.length) % PUZZLES.length;
    const next = PUZZLES[nextIndex];
    setPuzzleIndex(nextIndex);
    setState(cloneState(next.state));
    setSelected(null);
    setLastMove(null);
    setSolutionPly(0);
    setStatus('ready');
    setNotice('找到第一步唯一胜着，并把 M2 强制胜法走到底。');
    setProof([]);
    setShowHint(false);
    setVerification(null);
    setVerifying(false);
  }

  function resetPuzzle(): void {
    actionToken.current += 1;
    setState(cloneState(puzzle.state));
    setSelected(null);
    setLastMove(null);
    setSolutionPly(0);
    setStatus('ready');
    setNotice('局面已复原。重新寻找连续两次唯一胜着。');
    setProof([]);
    setShowHint(false);
  }

  function makePlayerMove(move: Move): void {
    const token = actionToken.current + 1;
    actionToken.current = token;
    const label = formatMove(state, move);
    const next = applyMove(state, move);
    const expectedMoveKey = puzzle.expectedPrincipalVariationKeys[solutionPly];
    const preservesWin = moveKey(move) === expectedMoveKey;
    setState(next);
    setLastMove(move);
    setSelected(null);
    if (preservesWin) {
      const nextProof = [...proof, label];
      setProof(nextProof);
      const defenseKey = puzzle.expectedPrincipalVariationKeys[solutionPly + 1];
      if (!defenseKey) {
        setStatus('correct');
        setNotice(`${label}。M${puzzle.mateMoves} 强制终局完成，两次胜方决策均为唯一。`);
        return;
      }

      setStatus('thinking');
      setNotice(`${label} 保持强制胜势。守方正在选择证明线中的最强抵抗…`);
      window.setTimeout(() => {
        if (actionToken.current !== token) return;
        const defense = generateLegalMoves(next).find((candidate) => moveKey(candidate) === defenseKey);
        if (!defense) {
          setStatus('wrong');
          setNotice('存档主变化与当前引擎不一致；请使用“本机重新验证”复查此题。');
          return;
        }
        const defenseLabel = formatMove(next, defense);
        setState(applyMove(next, defense));
        setLastMove(defense);
        setSolutionPly(solutionPly + 2);
        setProof([...nextProof, defenseLabel]);
        setStatus('ready');
        setNotice(`${defenseLabel}。守方已作最长抵抗；现在找到第二次唯一胜着。`);
      }, 360);
      return;
    }

    setStatus('thinking');
    setProof([label]);
    setNotice(`${label} 不能维持已证明的强制胜利，求解器正在给出最佳反证…`);
    window.setTimeout(() => {
      if (actionToken.current !== token) return;
      const remainingDepth = Math.max(1, puzzle.proofDepth - solutionPly - 1);
      const result = searchForcedOutcome(next, remainingDepth);
      const line = buildPv(next, result.pv);
      setProof([label, ...line]);
      if (result.bestMove) {
        setState(applyMove(next, result.bestMove));
        setLastMove(result.bestMove);
      }
      setStatus('wrong');
      setNotice(`强制胜证明在第 ${Math.floor(solutionPly / 2) + 1} 次决策处断裂；此着不再保证七层窗口内获胜。`);
    }, 80);
  }

  function handleSquare(x: number, y: number): void {
    if (status !== 'ready' || state.turn !== puzzle.human) return;
    const destination = selectedMoves.find((move) => move.to[0] === x && move.to[1] === y);
    if (destination) {
      makePlayerMove(destination);
      return;
    }
    const occupant = pieceAt(state, x, y);
    if (occupant?.side === puzzle.human) {
      setSelected((current) => current === occupant.id ? null : occupant.id);
    } else {
      setSelected(null);
    }
  }

  function verifyPuzzle(): void {
    if (verifying) return;
    const token = verificationToken.current + 1;
    verificationToken.current = token;
    setVerifying(true);
    setVerification(null);
    window.setTimeout(() => {
      if (verificationToken.current !== token) return;
      const report = proveForcedWinRigidity(
        puzzle.state,
        puzzle.proofDepth,
        puzzle.winnerTurns,
        puzzle.uniqueWinnerTurns,
        1,
      );
      setVerification({
        legal: generateLegalMoves(puzzle.state).length,
        winning: report.rootWinningMoves.length,
        mateMoves: report.mateMoves,
        rigid: report.rigid,
        decisionNodes: report.decisionNodes,
        defenseBranches: report.defenseBranches,
        nodes: report.stats.nodes,
        cutoffs: report.stats.cutoffs,
        tableHits: report.stats.tableHits,
        elapsedMs: Math.round(report.stats.elapsedMs),
      });
      setVerifying(false);
    }, 80);
  }

  const resultLabel = status === 'correct' ? '强制胜利' : status === 'wrong' ? '证明断裂' : status === 'thinking' ? '正在推演' : '轮到你';

  return (
    <main className="shell">
      <header className="topbar">
        <button className="brand-lockup" type="button" onClick={() => loadPuzzle(0)} aria-label="返回第一题">
          <span className="seal">弈</span>
          <span className="brand-copy"><small>ROYAL COLLISION LAB</small><strong>楚河 · 王域</strong></span>
        </button>
        <nav aria-label="站点信息">
          <button type="button" onClick={() => setPanel('rules')}>混合规则</button>
          <button type="button" onClick={() => setPanel('research')}>规则与源码审计</button>
          <span className="status-pill"><i /> 本地求解器</span>
        </nav>
      </header>

      <section className="workspace">
        <aside className="brief-card">
          <div className="puzzle-heading">
            <p className="eyebrow">残局 {puzzle.number} · {puzzle.material}</p>
            <span>连续唯一</span>
          </div>
          <h1>{puzzle.title}</h1>
          <p className="lede">{puzzle.subtitle}</p>

          <div className="side-row">
            <span className={`mini-piece ${puzzle.human}`}>{puzzle.human === 'xiangqi' ? '帅' : '♚'}</span>
            <div><small>{resultLabel}</small><strong>你执 {factionName(puzzle.human)}</strong></div>
          </div>

          <div className={`notice ${status}`} role="status" aria-live="polite">
            <span>{status === 'correct' ? '✓' : status === 'wrong' ? '×' : status === 'thinking' ? '…' : '!'}</span>
            <p>{notice}</p>
          </div>

          {showHint && <p className="hint"><strong>提示</strong>{puzzle.hint}</p>}

          <div className="action-row">
            {(status === 'correct' || status === 'wrong') ? (
              <button className="primary-action" type="button" onClick={() => loadPuzzle(puzzleIndex + 1)}>下一残局 <span>→</span></button>
            ) : (
              <button className="primary-action" type="button" onClick={() => setShowHint((value) => !value)}>{showHint ? '收起提示' : '给我一点提示'} <span>＋</span></button>
            )}
            <button className="icon-action" type="button" onClick={resetPuzzle} aria-label="重置残局">↺</button>
          </div>

          <div className="puzzle-list" aria-label="残局列表">
            {PUZZLES.map((item, index) => (
              <button className={index === puzzleIndex ? 'active' : ''} type="button" key={item.id} onClick={() => loadPuzzle(index)} aria-label={`打开残局 ${item.number}：${item.title}`}>
                <span>{item.number}</span><div><strong>{item.title}</strong><small>{item.material} · {item.human === 'xiangqi' ? '执象' : '执国'}</small></div>
              </button>
            ))}
          </div>
        </aside>

        <section className="board-stage" aria-label={`${puzzle.title}混合棋残局`}>
          <div className="board-meta"><span>国际象棋 · 北</span><strong>{puzzle.number}</strong><span>中国象棋 · 南</span></div>
          <div className={`board ${inCheck ? 'board-check' : ''}`}>
            <div className="palace palace-north" aria-hidden="true" />
            <div className="palace palace-south" aria-hidden="true" />
            <div className="river" aria-hidden="true"><span>楚 河</span><i>ROYAL COLLISION</i><span>王 域</span></div>
            {Array.from({ length: 90 }, (_, index) => {
              const x = index % 9;
              const y = Math.floor(index / 9);
              const occupant = pieceAt(state, x, y);
              const destination = selectedMoves.find((move) => move.to[0] === x && move.to[1] === y);
              const isSelected = occupant?.id === selected;
              const isLast = Boolean(lastMove && ((lastMove.from[0] === x && lastMove.from[1] === y) || (lastMove.to[0] === x && lastMove.to[1] === y)));
              const selectable = status === 'ready' && occupant?.side === puzzle.human && legalMoves.some((move) => move.pieceId === occupant.id);
              const classes = ['square-button', destination ? 'destination' : '', destination?.captureId ? 'capture-target' : '', isSelected ? 'selected' : '', isLast ? 'last' : ''].filter(Boolean).join(' ');
              return (
                <button
                  className={classes}
                  type="button"
                  key={`${x}-${y}`}
                  onClick={() => handleSquare(x, y)}
                  aria-label={`${squareName(x, y)}${occupant ? `，${factionName(occupant.side)} ${PIECE_MARK[occupant.type]}` : '，空位'}${destination ? '，可走' : ''}`}
                  disabled={status === 'thinking'}
                >
                  {y === 9 && <small className="file-label">{String.fromCharCode(97 + x)}</small>}
                  {x === 8 && <small className="rank-label">{10 - y}</small>}
                  {destination && <span className="move-dot" />}
                  {occupant && <span className={`piece ${occupant.side} ${selectable ? 'selectable' : ''}`}>{PIECE_MARK[occupant.type]}</span>}
                </button>
              );
            })}
          </div>
          <div className="mobile-puzzle-strip">
            <button type="button" onClick={() => loadPuzzle(puzzleIndex - 1)} aria-label="上一题">←</button>
            <span>{puzzle.number} / {PUZZLES.length.toString().padStart(2, '0')} · {puzzle.title}</span>
            <button type="button" onClick={() => loadPuzzle(puzzleIndex + 1)} aria-label="下一题">→</button>
          </div>
        </section>

        <aside className="analysis-card">
          <div className="analysis-title"><p className="eyebrow">威胁扫描</p><span>{puzzle.motif}</span></div>
          <div className="threat">
            <span>+M{puzzle.mateMoves}</span>
            <div><small>执子方已证明</small><strong>两回合强制获胜</strong></div>
          </div>
          <dl>
            <div><dt>当前合法着</dt><dd>{legalMoves.length}</dd></div>
            <div><dt>根节点胜着</dt><dd className="accent">{puzzle.expectedWinningMoveKeys.length}</dd></div>
            <div><dt>连续唯一</dt><dd>{puzzle.uniqueWinnerTurns}/{puzzle.winnerTurns} 次</dd></div>
            <div><dt>复证窗口</dt><dd>{puzzle.proofDepth} ply</dd></div>
          </dl>

          {proof.length > 0 ? (
            <div className="line-preview">
              <small>主变化 / PRINCIPAL VARIATION</small>
              {proof.map((line, index) => <p key={`${line}-${index}`}><b>{index + 1}</b>{line}</p>)}
            </div>
          ) : (
            <div className="line-preview concealed">
              <small>主变化 / PRINCIPAL VARIATION</small>
              <p>先落子，证明线随后展开。</p>
              <p>唯一胜着不会在分析面板中提前泄露。</p>
            </div>
          )}

          <button className="verify-button" type="button" onClick={verifyPuzzle} disabled={verifying}>
            {verifying ? `正在复证 ${puzzle.proofDepth} 层全分支树…` : verification ? '重新验证此题' : '本机重新验证此题'}
          </button>
          {verification && (
            <div className="verification" aria-live="polite">
              <strong>{verification.rigid ? `证明一致：${verification.winning}/${verification.legal} 胜着，M${verification.mateMoves}` : '证明已发生变化'}</strong>
              <span>{verification.decisionNodes.toLocaleString()} 个胜方决策点 · {verification.defenseBranches.toLocaleString()} 条防守边</span>
              <span>{verification.nodes.toLocaleString()} 节点 · {verification.cutoffs.toLocaleString()} 次剪枝</span>
              <span>{verification.tableHits.toLocaleString()} 次置换命中 · {verification.elapsedMs} ms</span>
            </div>
          )}
          <p className="engine-note">PVS / α–β · 置换表 · 杀手着 · 历史启发 · 严格终局证明</p>
        </aside>
      </section>

      <footer>
        <span>残局定义：{puzzle.material.toLowerCase()} 少子力 · M{puzzle.mateMoves} · 前 {puzzle.uniqueWinnerTurns} 次胜方决策唯一</span>
        <button type="button" onClick={() => setPanel('rules')}>为什么这里不是“吃王”？</button>
      </footer>

      {panel && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPanel(null); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" type="button" onClick={() => setPanel(null)} aria-label="关闭">×</button>
            {panel === 'rules' ? <RulesPanel /> : <ResearchPanel />}
          </section>
        </div>
      )}
    </main>
  );
}

function RulesPanel() {
  return (
    <>
      <p className="eyebrow">HYBRID LAW · V0.1</p>
      <h2 id="modal-title">混合规则公约</h2>
      <p className="modal-intro">两套正规规则无法直接拼接；以下是本原型公开、确定、可由代码复现的裁决口径。</p>
      <div className="rule-grid">
        <article><span>01</span><h3>棋盘与走法</h3><p>统一使用象棋的 9×10 交叉点棋盘。象棋子保留九宫、河界、蹩马腿、塞象眼与炮架；国际棋子在全盘按原方向移动。</p></article>
        <article><span>02</span><h3>王法</h3><p>王与帅都不能被实际吃掉，也不能走进受攻击点。无合法着即负：被将军是将死，未被将军则按本混合规则“困毙负”。</p></article>
        <article><span>03</span><h3>飞将</h3><p>帅与西洋王处在同一纵线且中间无子时，视为帅沿纵线攻击西洋王；任何一方都不能制造或保留非法照面。</p></article>
        <article><span>04</span><h3>残局简化</h3><p>关闭王车易位、吃过路兵、兵的首次两格与长将长捉裁决；西洋兵抵达南端自动升后。当前短杀题不启用重复与自然限着。</p></article>
      </div>
      <div className="definition-box"><strong>什么叫这里的“强胜残局”？</strong><p>双方仅余 2–5 子（王/将计入）。执子方可在公开的七层窗口内强制终局；首着以及沿全部防守分支到达的第二次决策都只有一条继续获胜的走法。</p></div>
      <div className="source-links">
        <a href="https://rcc.fide.com/fide-laws-of-chess_fulltexthtml/" target="_blank" rel="noreferrer">FIDE 国际象棋规则 ↗</a>
        <a href="https://www.wxf-xiangqi.org/images/wxf-rules/2018_World_XiangQi_Rules_English2018.pdf" target="_blank" rel="noreferrer">WXF 世界象棋规则 ↗</a>
      </div>
    </>
  );
}

function ResearchPanel() {
  return (
    <>
      <p className="eyebrow">SOURCE & PRIOR ART AUDIT</p>
      <h2 id="modal-title">源码与同类产品调查</h2>
      <p className="modal-intro">上游仓库只作为原生规则与测试基线保存在本地；混合引擎为独立实现，没有把 GPL 代码打包进网页。</p>
      <div className="repo-grid">
        <article><div><span>国际象棋基线</span><b>4,389 ★</b></div><h3>jhlywa/chess.js</h3><p>BSD-2-Clause · 固定提交 d43e668</p><p>461 / 464 测试通过；3 项失败仅为 Windows 换行符差异。Perft 与将死测试均通过，生产依赖漏洞为 0。</p><a href="https://github.com/jhlywa/chess.js" target="_blank" rel="noreferrer">查看仓库 ↗</a></article>
        <article><div><span>中国象棋基线</span><b>243 ★</b></div><h3>xqbase/xqwlight</h3><p>GPL-2.0 · 固定提交 6221733</p><p>本地跑过 240 个残局：7,809 个生成着与合法着基线一致，7,207 着通过自将过滤，718 着形成将军。</p><a href="https://github.com/xqbase/xqwlight" target="_blank" rel="noreferrer">查看仓库 ↗</a></article>
      </div>
      <h3 className="section-label">可借鉴的网站</h3>
      <div className="precedent-list">
        <a href="https://www.pychess.org/" target="_blank" rel="noreferrer"><strong>PyChess</strong><span>多棋种、AI 与自定义变体</span>↗</a>
        <a href="https://fairy-stockfish.github.io/online/" target="_blank" rel="noreferrer"><strong>Fairyground</strong><span>自定义规则与在线分析</span>↗</a>
        <a href="https://chesscraft.ca/" target="_blank" rel="noreferrer"><strong>ChessCraft</strong><span>棋盘/棋子沙盒与 AI</span>↗</a>
        <a href="https://chessperiment.app/en/editor" target="_blank" rel="noreferrer"><strong>Chessperiment</strong><span>浏览器变体编辑器</span>↗</a>
        <a href="https://www.xiangqi.com/xiangqi-puzzle" target="_blank" rel="noreferrer"><strong>Xiangqi.com</strong><span>象棋残局创建与练习</span>↗</a>
      </div>
      <p className="research-note">调查中找到了“象棋军队对国际棋军队”的社区构想，也找到了通用变体平台；尚未发现专门围绕 2v4 / 3v5、并公开复证“执子方强胜且连续胜着唯一”的同类网页。这是基于公开检索结果的判断，不是不存在性证明。</p>
    </>
  );
}
