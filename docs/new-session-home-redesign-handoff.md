# Context Reader 新会话接手说明

核验日期：2026-09-18。当前已接受生产 release `20260917T152400`，parent `20260916T210459`，source `cb5a375fee7d7b4f1d443d37fee80d2a07b72e0a`；版本运行证据见 [release-governance.md](release-governance.md)。本次 GitHub/文档整理不重新部署，不代表视觉验收。

## 读取顺序

1. `AGENTS.md`、`PRODUCT.md`、`README.md`。
2. `docs/gpt-brief.md` 与任务相关的 `architecture.md` / `integration-guide.md`。
3. 首页工作先读 `home-redesign-current-decisions.md`、`home-redesign-implementation-audit.md`、`home-v2-implementation-contract.md`；访谈和 `product-journey.md` 仅解释历史。
4. 发布前读 `release-governance.md`，再现场核实公网版本和服务器 current symlink，不从本说明的日期推定版本未变。

用户最新明确表达高于旧文档。多方向设计问题使用可点击 HTML 问卷；明确修复无需重问。上一轮先归档，当前决定、审计、合同、GPT 简报和 journey 同轮对齐。

## 当前实现与边界

真实根首页运行 `HomeRedesign`，数据来自 SSR 外刊和 `HomeClient`，进入真实 `ReaderView`。游客为品牌 → 录屏展示 → 外刊 → 导入 → 反馈；登录工作台保持快速阅读入口。旧书本翻页和七卡功能环已被覆盖，不能重新作为基线。

桌面探索为物理吊牌，手机为直接说明入口。桌面词典按 9 月 15 日决定可拖动、调大小且不跨会话存几何；手机保持底部面板。密码新规则为 8–72 位含字母数字，六位仅兼容旧登录。学习数据以 IndexedDB 与协议 2 为准，登录不等待整库恢复。

Lusion 共享图像往返的完整逐帧还原、复杂动效最终用户接受、缺失录屏素材和真实设备复验仍需跟踪，不能通过构建或旧“待发布”字样判断。具体未完成项保留在实现审计。

## 接手执行

- 查 `git status`、分支及远端；共享根目录可能是旧脏副本，不是最新生产源。
- 以现场生产 sourceRevision 建专属 `codex/*` worktree；只集成已审查提交。
- 完成功能后验证、按授权发布并记录证据；纯文档不用部署。
- 自动推送任务分支后，还要累计集成到 GitHub 默认 `main` 并核验远端 SHA；不能再把分支推送当作完整同步。
- 提交并交接后及时移除自己的干净 worktree，保留分支和提交；禁止删其他脏目录。
