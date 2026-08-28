'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  analyseSurvivalMoves,
  applyMove,
  formatMove,
  generateLegalMoves,
  isInCheck,
  moveKey,
  pieceAt,
  PIECE_MARK,
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
  safe: number;
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
  const [puzzleIndex, setPuzzleIndex] = useState(0);
  const puzzle = PUZZLES[puzzleIndex];
  const [state, setState] = useState<GameState>(() => cloneState(PUZZLES[0].state));
  const [selected, setSelected] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [status, setStatus] = useState<PlayStatus>('ready');
  const [notice, setNotice] = useState('找到一着，让对手无法在四步内强制终局。');
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
    const nextIndex = (index + PUZZLES.length) % PUZZLES.length;
    const next = PUZZLES[nextIndex];
    setPuzzleIndex(nextIndex);
    setState(cloneState(next.state));
    setSelected(null);
    setLastMove(null);
    setStatus('ready');
    setNotice('找到一着，让对手无法在四步内强制终局。');
    setProof([]);
    setShowHint(false);
    setVerification(null);
    setVerifying(false);
  }

  function resetPuzzle(): void {
    setState(cloneState(puzzle.state));
    setSelected(null);
    setLastMove(null);
    setStatus('ready');
    setNotice('局面已复原。重新寻找生路。');
    setProof([]);
    setShowHint(false);
  }

  function makePlayerMove(move: Move): void {
    const label = formatMove(state, move);
    const next = applyMove(state, move);
    const survives = puzzle.expectedSafeMoveKeys.includes(moveKey(move));
    setState(next);
    setLastMove(move);
    setSelected(null);
    if (survives) {
      setStatus('correct');
      setNotice(`${label}。杀网被拆开——这条路通过了七层证明。`);
      setProof([label]);
      return;
    }

    setStatus('thinking');
    setNotice(`${label} 看似可走，求解器正在给出强制反驳…`);
    window.setTimeout(() => {
      const result = searchForcedOutcome(next, puzzle.horizonMoves * 2 - 1);
      const line = buildPv(next, result.pv);
      setProof(line);
      if (result.bestMove) {
        setState(applyMove(next, result.bestMove));
        setLastMove(result.bestMove);
      }
      setStatus('wrong');
      setNotice(`落入 M${result.mateMoves ?? puzzle.horizonMoves} 杀网。下方主变化给出可复查证明。`);
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
    setVerifying(true);
    setVerification(null);
    window.setTimeout(() => {
      const report = analyseSurvivalMoves(puzzle.state, puzzle.horizonMoves);
      setVerification({
        legal: report.legal.length,
        safe: report.safe.length,
        nodes: report.stats.nodes,
        cutoffs: report.stats.cutoffs,
        tableHits: report.stats.tableHits,
        elapsedMs: Math.round(report.stats.elapsedMs),
      });
      setVerifying(false);
    }, 80);
  }

  const resultLabel = status === 'correct' ? '破局成功' : status === 'wrong' ? '落入杀网' : status === 'thinking' ? '正在推演' : '轮到你';

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
            <span>{puzzle.expectedSafeMoveKeys.length === 1 ? '唯一着' : '双解'}</span>
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
            <span>−M{puzzle.horizonMoves}</span>
            <div><small>走错即进入</small><strong>四步强制终局</strong></div>
          </div>
          <dl>
            <div><dt>当前合法着</dt><dd>{legalMoves.length}</dd></div>
            <div><dt>初始生路</dt><dd className="accent">{puzzle.expectedSafeMoveKeys.length}</dd></div>
            <div><dt>证明深度</dt><dd>7 ply</dd></div>
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
              <p>生路不会在分析面板中提前泄露。</p>
            </div>
          )}

          <button className="verify-button" type="button" onClick={verifyPuzzle} disabled={verifying}>
            {verifying ? '正在穷举七层博弈树…' : verification ? '重新验证此题' : '本机重新验证此题'}
          </button>
          {verification && (
            <div className="verification" aria-live="polite">
              <strong>证明一致：{verification.safe} 条生路</strong>
              <span>{verification.nodes.toLocaleString()} 节点 · {verification.cutoffs.toLocaleString()} 次剪枝</span>
              <span>{verification.tableHits.toLocaleString()} 次置换命中 · {verification.elapsedMs} ms</span>
            </div>
          )}
          <p className="engine-note">α–β 剪枝 · 置换表 · 将军/吃子优先排序 · 无云端 AI</p>
        </aside>
      </section>

      <footer>
        <span>残局定义：含王/将在内的 {puzzle.material.toLowerCase()} 少子力局面</span>
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
        <article><span>04</span><h3>残局简化</h3><p>关闭王车易位、吃过路兵、兵的首次两格与长将长捉裁决；西洋兵抵达南端自动升后。四步题不启用重复与自然限着。</p></article>
      </div>
      <div className="definition-box"><strong>什么叫这里的“残局”？</strong><p>双方仅余 2–5 子（王/将计入）。轮到玩家时只有 1–2 着能避开对手在最多四个回合内的强制终局；其它每一合法着都由完全搜索给出反驳线。</p></div>
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
      <p className="research-note">调查中找到了“象棋军队对国际棋军队”的社区构想，也找到了通用变体平台；尚未发现专门围绕 2v4 / 3v5、并公开证明“只有 1–2 条生路”的同类网页。这是基于公开检索结果的判断，不是不存在性证明。</p>
    </>
  );
}
