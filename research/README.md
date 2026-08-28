# 楚河·王域：规则与上游审计

审计日期：2026-08-28（Asia/Shanghai）

## 本地规则资料

- `rules/FIDE-Laws-of-Chess-2023.pdf`：FIDE Laws of Chess，2023-01-01 生效。
- `rules/WXF-World-Xiangqi-Rules-2018.pdf`：World Xiangqi Federation，2018 World XiangQi Rules。

两份 PDF 是本地审计输入，公开仓库不再分发。请从 [FIDE 官方规则](https://rcc.fide.com/fide-laws-of-chess_fulltexthtml/) 与 [WXF 官方 PDF](https://www.wxf-xiangqi.org/images/wxf-rules/2018_World_XiangQi_Rules_English2018.pdf) 获取；下载后的文件会被 `.gitignore` 排除。

关键原文结论：

- FIDE 1.4.1 明确规定胜利条件是将死，实际“吃王”不允许；FIDE 5.2.1 把无合法着但未被将军判为和棋。
- WXF 2.8 明确只有王/将以外的棋子可以被吃；2.9 禁止两王/将同纵线无遮挡；3.1.A 把将死和困毙都判负。

## 本原型的混合裁决

两套规则在棋盘尺寸、王域与困毙结果上并不兼容，因此不能声称存在一套“官方混合规则”。v0.1 采用以下公开约定：

1. 使用 9×10 象棋交叉点棋盘。
2. 每种棋子保留原生移动几何；帅、仕、相保留九宫/河界限制，马保留蹩腿，炮保留炮架。
3. 王与帅均为不可被实际吃掉的 royal piece；不能自陷将军。
4. 帅沿无遮挡纵线攻击西洋王，因而双方不能形成“照面”。
5. 为了得到明确、短促的残局证明，无合法着一律判负（采用 WXF 困毙口径）。
6. 关闭王车易位、吃过路兵、兵首次两格、长将长捉和重复裁决；西洋兵到达南端自动升后。

## GitHub 上游

### jhlywa/chess.js

- URL: <https://github.com/jhlywa/chess.js>
- 固定提交：`d43e6683efeefbd07f8c53e8e7a47c62cf612439`
- 观测热度：4,389 stars / 986 forks
- 许可证：BSD-2-Clause
- 用途：国际象棋走法、将军、将死与 perft 基线；没有作为 9×10 混合引擎直接导入。
- 本地测试：464 项中 461 项通过；3 项失败都只比较出 `CRLF` 与 `LF` 的 PGN 换行差异。所有 perft、走法、将军、将死与王车易位测试通过。
- `npm audit --omit=dev`：0 vulnerabilities。完整开发工具链审计报告 22 项（1 low / 6 moderate / 13 high / 2 critical），所以本项目没有把该工具链或仓库作为生产依赖发布。

### xqbase/xqwlight

- URL: <https://github.com/xqbase/xqwlight>
- 固定提交：`6221733f1f79b3acb44cce6f83dc6100443cb2c9`
- 观测热度：243 stars / 93 forks
- 许可证：GPL-2.0
- 用途：中国象棋 9×10 走法与搜索参考。由于 GPL 边界，仓库仅保存在 `research/upstream/` 做本地审计，没有拷入网页运行包。
- 本地测试：240 个残局；7,809 个枚举合法着与 7,809 个生成着基线一致；其中 7,207 着通过自将过滤，718 着形成将军。

`research/upstream/` 在主项目中被忽略，避免嵌套 Git 仓库和上游依赖进入部署包；两份浅克隆仍保留在本机。

## 本项目验证

- `node --experimental-strip-types scripts/engine-audit.mjs`：13 项混合规则与强胜搜索单元审计，其中包含独立全宽 minimax 对 PVS 结果的交叉检查。
- `node --experimental-strip-types scripts/verify-puzzles.mjs`：对 8 题逐题执行七层根着分类与刚性复证；每题均为 M2，183 个合法首着中只有 8 条可证明强胜，并且沿全部防守分支到达的第二次胜方决策仍唯一。
- `node --experimental-strip-types scripts/random-winning-puzzles.mjs --count=6 --seed=77`：在 2v4、3v4、3v5 空间内随机生成合法布局，用 3–5 ply mate-only 搜索预筛，再以七层全分支证明检查胜着唯一性。
- `node --experimental-strip-types scripts/evolve-winning-puzzles.mjs --count=6`：系统枚举已知强胜母题的单子位移，寻找保持或延长杀程的新结构。
- `node --experimental-strip-types scripts/search-winning-puzzles.mjs --count=6 --seed=17`：从短杀母题做无吃子合法逆向回溯，偏好低分支防守节点，再进行正向复证。
- `node scripts/audit-xqwlight.mjs`：复跑 xqwlight 固定语料基线。
- `pnpm exec tsc --noEmit` 与 `pnpm run build`：类型和部署构建。

求解器使用 mate-only negamax、迭代加深、PVS、alpha-beta 剪枝、跨根着共享置换表、杀手着与历史启发。置换表着、将军、吃子和升变优先；没有使用 null-move、futility 或可能漏解的选择性裁剪。深度为 7 ply；非终局叶子一律记 0，因此“强制获胜”不会被静态子力分冒充。

当前 8 题的一次完整根着分类与刚性复证合计访问 1,143,959 个节点。随机阶段以种子 77、78、79 检查了 8,230 个通过初始合法性过滤的布局，其中 182 个进入七层刚性复证；系统演化阶段另生成 1,824 个单子位移布局。最终只保留战术结构有差异、主变化合法且自动复证稳定的题目。

此前 v0.1 的“避败残局”搜索器仍以 `generate:survival` 与 `evolve:survival` 命令保留，便于复现实验历史，但其题目资格已经被 v0.2 的“执子方强胜且连续胜着唯一”取代。

## 同类网站调查

- [PyChess](https://www.pychess.org/)：多棋种、AI、用户自定义 Fairy-Stockfish 变体。
- [Fairyground / Fairy-Stockfish online](https://fairy-stockfish.github.io/online/)：自定义变体与交互分析。
- [ChessCraft](https://chesscraft.ca/)：自定义棋盘、规则、棋子和 AI。
- [Chessperiment](https://chessperiment.app/en/editor)：浏览器中的通用棋类变体编辑器。
- [Xiangqi.com Puzzles](https://www.xiangqi.com/xiangqi-puzzle)：象棋残局创建和练习。
- [社区中的 Chess vs Xiangqi 构想](https://www.reddit.com/r/AnarchyChess/comments/1i9w7xl)：说明军队对阵概念有人讨论，但不是可验证残局产品。

公开检索没有发现一个专门以 2v4、3v4、3v5 “象棋军队 vs 国际象棋军队”，并逐着公开“执子方强胜且连续胜着唯一”证明为核心的现成网站；这是检索结论，不是不可能存在的证明。
