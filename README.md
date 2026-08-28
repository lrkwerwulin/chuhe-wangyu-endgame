<div align="center">

# 楚河·王域

**在同一张 9×10 棋盘上，破解经过完全搜索验证的象棋 VS 国际象棋少子残局。**

<img src="assets/banner.webp" alt="楚河·王域——象棋 VS 国际象棋残局实验室" width="100%">

[![License: MIT](https://img.shields.io/badge/License-MIT-c8a56a.svg)](./LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-3c873a.svg)](https://nodejs.org/)
[![Verified puzzles](https://img.shields.io/badge/verified%20puzzles-16-a9463d.svg)](./lib/puzzles.ts)

[在线体验](https://chuhe-wangyu-endgame.lrk-wer.chatgpt.site) · [规则与审计](./research/README.md) · [参与贡献](./CONTRIBUTING.md)

</div>

## 这是什么

楚河·王域是一套可玩的跨棋种残局实验：象棋与国际象棋棋子共处于 9×10 象棋棋盘，各自保留原生移动方式，再由统一的王权、安全与终局规则完成裁决。

项目关注的不是静态“子力估值”，而是一类非常具体的问题：轮到玩家时，是否只有一至两着能够避开对手在最多四次行动内的强制终局？每个入库残局都由 mate-only 搜索逐一复核全部合法首着。

当前线上预览由 OpenAI Sites 托管，访问时可能需要登录。仓库可完全本地运行。

## 核心体验

- **16 个可玩残局**：覆盖 2 VS 4、3 VS 4、3 VS 5，双方分别执象棋或国际象棋。
- **每着均可解释**：正确着显示生路；错误着给出对手的强制反驳主线。
- **浏览器内重新证明**：可在当前设备重新穷举七层博弈树，查看节点、剪枝和置换表命中。
- **可复现生成**：固定随机种子的母题生成与演化突变负责发现候选，完全搜索负责最终裁决。

## 快速开始

需要 Node.js 22.13+ 与 pnpm 10。

```bash
git clone https://github.com/lrkwerwulin/chuhe-wangyu-endgame.git
cd chuhe-wangyu-endgame
pnpm install --frozen-lockfile
pnpm dev
```

浏览器打开 `http://localhost:3000/`。

## 什么算“残值残局”

本项目把用户最初提出的“残值”落实为可检查的生存约束：

| 约束 | 定义 |
|---|---|
| 少子力 | 双方各有 2–5 枚棋子，王与将计入 |
| 生路 | 当前搜索窗口内，未被证明会遭遇强制终局的合法着 |
| 题目资格 | 生路必须恰好有 1–2 条 |
| 败着证明 | 其余每一合法着均能在对手最多四次行动内被强制终结 |
| 搜索深度 | 玩家首着后继续搜索 7 ply |

这里的“生路”不是无限深度必胜声明。它只表示该着没有在公开的四回合证明窗口内被判负；这一边界会在界面与验证脚本中保持一致。

## 混合规则

两套官方规则并没有现成的混合版本，因此本项目明确公开自己的实验约定：

| 领域 | 约定 |
|---|---|
| 棋盘 | 使用 9×10 象棋交叉点棋盘 |
| 走法 | 各棋子保留原生几何；马保留蹩腿、炮保留炮架，仕/相/将保留九宫与河界 |
| 王权 | 王与将均不可被实际吃掉，也不能走入或暴露在将军中 |
| 将帅照面 | 象棋将沿无遮挡纵线攻击西洋王 |
| 无合法着 | 统一判负，采用 WXF 的困毙口径 |
| 简化项 | 关闭王车易位、吃过路兵、兵首次两格、重复与长将长捉裁决；西洋兵抵达南端自动升后 |

国际象棋官方规则规定将死结束对局、王不能被实际吃掉，困毙为和棋；WXF 同样不允许吃将，但困毙判负。混合规则选择后者，是为了让短残局拥有明确终局。

## 求解与生成

```text
母题 / 已验证残局
        ↓
固定种子添子或 1–3 次位置/棋种突变
        ↓
非法局面与低质量分支过滤
        ↓
3 ply 启发式预筛
        ↓
7 ply mate-only 完全复证
        ↓
仅保留 1–2 条生路的残局
```

求解器位于 [`lib/hybrid-engine.ts`](./lib/hybrid-engine.ts)，使用：

- mate-only negamax；
- alpha-beta 剪枝；
- 置换表；
- 将军、吃子、升变优先的着法排序；
- 非终局叶子固定记为 0，不用静态子力分冒充强制胜负。

当前 16 题共覆盖 102 个合法首着，其中 20 条生路、82 条可在四回合内证明的败着。一次完整验证共访问约 231 万个节点；节点数可能随运行环境和着法排序实现变化。

## 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 启动本地交互站点 |
| `pnpm build` | 构建 Cloudflare Worker 兼容产物 |
| `pnpm lint` | 检查代码规范 |
| `pnpm typecheck` | 运行 TypeScript 类型检查 |
| `pnpm audit:engine` | 执行 11 项混合规则审计 |
| `pnpm verify:puzzles` | 完全复核全部残局的生路与反驳深度 |
| `pnpm generate:puzzles -- --count=6 --seed=17` | 从短杀母题生成候选 |
| `pnpm evolve:puzzles -- --count=6 --seed=20260830` | 从已验证题目演化候选 |

## 添加一个残局

题目定义集中在 [`lib/puzzles.ts`](./lib/puzzles.ts)。坐标采用零基数组：`x = 0..8` 对应 `a..i`，`y = 0..9` 对应 `10..1`。

一个候选进入主题库前必须满足：

1. `validateState` 没有规则错误或重叠棋子；
2. `expectedSafeMoveKeys` 与求解器结果完全一致；
3. 生路数量为 1–2；
4. 每个其余合法着的 `mateIn` 不为空且不大于 4；
5. `pnpm verify:puzzles` 全部通过；
6. 题目不是只靠无关添子制造的重复构型。

## 项目结构

```text
app/                         交互界面、棋盘与站点元数据
lib/hybrid-engine.ts         混合规则、合法着与搜索器
lib/puzzles.ts               已验证残局题库
scripts/                     规则审计、题库复核与候选生成
research/README.md           官方规则、上游仓库与实验约定
assets/banner.webp           GitHub 项目封面
```

## 规则资料与上游参考

- [FIDE Laws of Chess](https://rcc.fide.com/fide-laws-of-chess_fulltexthtml/)
- [WXF World XiangQi Rules 2018](https://www.wxf-xiangqi.org/images/wxf-rules/2018_World_XiangQi_Rules_English2018.pdf)
- [jhlywa/chess.js](https://github.com/jhlywa/chess.js)：国际象棋走法、perft 与将死测试基线，BSD-2-Clause。
- [xqbase/xqwlight](https://github.com/xqbase/xqwlight)：象棋走法与搜索参考，GPL-2.0。

两份上游仓库只用于本地审计，不会进入运行包；项目没有复制或链接 GPL 代码。官方规则 PDF 也不在公开仓库中再分发，请从上述官方来源获取。完整固定提交、测试结果和规则差异见 [`research/README.md`](./research/README.md)。

## 验证

提交前建议依次运行：

```bash
pnpm lint
pnpm typecheck
pnpm audit:engine
pnpm verify:puzzles
pnpm build
```

GitHub Actions 会在 push 和 pull request 上执行同样的检查。

## 贡献与安全

欢迎提交新的残局、规则测试、搜索优化和无障碍改进。请先阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。安全问题请遵循 [`SECURITY.md`](./SECURITY.md)，不要在公开 Issue 中披露敏感细节。

## 许可证

项目代码与自有视觉资产使用 [MIT License](./LICENSE)。第三方规则文本、名称、商标及上游项目仍归各自权利人所有，并适用各自许可证。
