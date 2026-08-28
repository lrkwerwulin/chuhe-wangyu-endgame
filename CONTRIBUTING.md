# 参与贡献

感谢你帮助改进楚河·王域。项目优先接受能够被自动验证、规则边界清楚的改动。

## 本地准备

```bash
pnpm install --frozen-lockfile
pnpm dev
```

需要 Node.js 22.13+ 与 pnpm 10。

## 提交新残局

在 `lib/puzzles.ts` 中添加题目，并确保：

- 双方各有且仅有一个王权棋子；
- 象棋将、仕、相的位置满足九宫与河界；
- 双方棋子总数符合 2 VS 4、3 VS 4 或 3 VS 5；
- 执子方能在公开深度内强制终局；
- 七层窗口内根节点恰好存在一条胜着；
- 沿守方全部合法分支到达的第二次胜方决策也恰好一条胜着；
- 存档主变化合法并以对方将死或困毙负结束；
- 标题、提示和母题说明不提前泄露全部答案；
- 与已有题目存在有意义的构型或战术差异。

运行：

```bash
pnpm verify:puzzles
```

## 提交前检查

```bash
pnpm lint
pnpm typecheck
pnpm audit:engine
pnpm verify:puzzles
pnpm build
```

## Pull Request

- 一个 PR 尽量只解决一个主题。
- 描述动机、行为变化与验证结果。
- 规则变化必须同步增加审计用例并更新 `research/README.md`。
- 不要提交 `research/upstream/`、官方规则 PDF、构建产物、环境变量或凭据。
- 引入第三方代码或资产时，注明来源、固定版本与许可证。

提交代码即表示你有权按项目的 MIT License 提供这些贡献。
