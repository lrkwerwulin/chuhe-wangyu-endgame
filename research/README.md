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

- `node --experimental-strip-types scripts/engine-audit.mjs`：15 项混合规则与强胜搜索单元审计，其中包含独立全宽 minimax 对 PVS 结果、H1–H3 逐着分类交叉检查，以及预算搜索“超限必须 aborted、足额必须等同精确搜索”的测试。
- `node --experimental-strip-types scripts/verify-puzzles.mjs`：对 12 题逐题执行 H1–H7/H9 根着分类与刚性复证；232 个合法首着中只有 12 条在各题窗口内可证明强胜，4 枚 M5 均在 H1–H8 无强杀、H9 首次得证。
- `node --experimental-strip-types scripts/measure-move-horizons.mjs`：输出每条首着的立即回应数、吃子/将军/升变标记、逐层三态序列、首次得证层与搜索成本；默认使用每题自己的证明深度。
- `node --experimental-strip-types scripts/random-winning-puzzles.mjs --count=6 --seed=77`：在 2v4、3v4、3v5 空间内随机生成合法布局，用 3–5 ply mate-only 搜索预筛，再以七层全分支证明检查胜着唯一性。
- `node --experimental-strip-types scripts/evolve-winning-puzzles.mjs --count=6`：系统枚举已知强胜母题的单子位移，寻找保持或延长杀程的新结构。
- `node --experimental-strip-types scripts/search-winning-puzzles.mjs --count=6 --seed=17`：从短杀母题做无吃子合法逆向回溯，偏好低分支防守节点，再进行正向复证。
- `node --experimental-strip-types scripts/reinforced-long-mate-search.mjs --target-moves=5 --seed=17`：从 M1 母题逐层构造 M2…M5，contextual-bandit/UCB 奖励策略只负责候选排序，精确搜索负责裁决。
- `node --experimental-strip-types scripts/scan-mate-neighborhood.mjs --source=nine-ply-a-file-knight-net --target-moves=6`：以两级节点预算扫描单子邻域；一级淘汰，二级只复证接近目标深度的未决候选。
- `node scripts/audit-xqwlight.mjs`：复跑 xqwlight 固定语料基线。
- `pnpm exec tsc --noEmit` 与 `pnpm run build`：类型和部署构建。

求解器使用 mate-only negamax、迭代加深、PVS、alpha-beta 剪枝、跨根着共享置换表、杀手着与历史启发。置换表着、将军、吃子和升变优先；没有使用 null-move、futility 或可能漏解的选择性裁剪。正式题深度为 7 或 9 ply；非终局叶子一律记 0，因此“强制获胜”不会被静态子力分冒充。批量发现阶段可以设置节点预算，但超限结果带有 `aborted: true`，只可用于调度，不能进入题库。

逐层分析使用 `win / loss / unresolved` 三态，而不是把没搜到反驳的着法叫作“可行”。H1 是首着本身，H2 包含守方一着，H3 包含胜方第二着。强制胜或强制负一旦在 Hn 成立，就可严格继承到更深窗口；实现据此跳过后续重复搜索，只有未决着法继续加深。每个残局的静态漏斗与立即回应边统计均写入题库，并由复核脚本重新计算后逐项比较。

M2 组的 H1–H7 聚合漏斗依次为 `0/0/183`、`0/0/183`、`8/0/175`、`8/29/146`、`8/29/146`、`8/44/131`、`8/44/131`（已证胜 / 已证负 / 未决）。M5 组有 49 条首着，H1–H8 均为 `0/0/49`，H9 为 `4/0/45`。全库共有 4,590 条立即回应边，范围 1–54，平均 19.78；逐层分类与刚性复证合计访问 3,835,318 个节点、完成 539,602 次剪枝并命中置换表 393,245 次。节点成本会随排序实现变化，三态结论则由测试锁定。

随机阶段以种子 77、78、79 检查了 8,230 个通过初始合法性过滤的布局，其中 182 个进入七层刚性复证；系统演化阶段另生成 1,824 个单子位移布局。长杀阶段从 M1 逐层找到 M5，再扫描单马 75 格与守方兵 83 格等邻域；正式保留 4 枚 M5，其中一题五次胜方决策全部唯一。实验还严格找到 M6（H1–H10 无强杀、H11 有强杀），并把根节点等价胜着从 4 条压到 2 条；因为没有达到唯一首着，明确不入库。

此前 v0.1 的“避败残局”搜索器仍以 `generate:survival` 与 `evolve:survival` 命令保留，便于复现实验历史，但其题目资格已经被 v0.2 的“执子方强胜且连续胜着唯一”取代。

## 同类网站调查

- [PyChess](https://www.pychess.org/)：多棋种、AI、用户自定义 Fairy-Stockfish 变体。
- [Fairyground / Fairy-Stockfish online](https://fairy-stockfish.github.io/online/)：自定义变体与交互分析。
- [ChessCraft](https://chesscraft.ca/)：自定义棋盘、规则、棋子和 AI。
- [Chessperiment](https://chessperiment.app/en/editor)：浏览器中的通用棋类变体编辑器。
- [Xiangqi.com Puzzles](https://www.xiangqi.com/xiangqi-puzzle)：象棋残局创建和练习。
- [社区中的 Chess vs Xiangqi 构想](https://www.reddit.com/r/AnarchyChess/comments/1i9w7xl)：说明军队对阵概念有人讨论，但不是可验证残局产品。

公开检索没有发现一个专门以 2v4、3v4、3v5 “象棋军队 vs 国际象棋军队”，并逐着公开“执子方强胜且连续胜着唯一”证明为核心的现成网站；这是检索结论，不是不可能存在的证明。
