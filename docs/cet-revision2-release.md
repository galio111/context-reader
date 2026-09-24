# CET revision2 生产发布记录（发布准备）

## 1. 执行环境与授权
用户2026-09-24明确授权验证后合入main及部署生产。生产授权ZIP SHA256为 `2b0e5278a66fe38acd5f68118b6ecf6224463b1a93c4cd31d6d8fce3e850f0f3`，替代旧规范。Windows独立任务worktree/分支 `codex/cet-revision2`，保留已发布高清封面及动效。

## 2. 功能与测试
R01–R18实现及77项逐项实际状态见 [验收记录](cet-revision2-acceptance.md) 和 [结构化验收](cet-revision2-acceptance.json)。32 CET、89关键回归、发布契约、出口审计通过；lint0错误42警告；正式构建通过。相关文章/同步扩展24/25，外刊自动发布测试在原基线也失败，未修改审核逻辑或放宽断言。

Windows IAB实际验证共享Reader查词/完整原句译文、跨行与反向拖词、20次题卡、按篇及整卷提交、正计时暂停刷新恢复、一分钟倒计时真实到期、日夜桌面1440×900与手机390×844、自定义列表展开、普通文章编辑跳转保护和近期阅读保留、独立词典、全文翻译、保存。截图在根工作区 `artifacts/cet-revision2-evidence/`；macOS实机与完整触屏设备矩阵未验证。初始浏览器连接失败已恢复，不再作为发布阻塞。

正计时使用schema3及独立v3活动/提交包命名空间；不批量改写v1/v2。协议2实际客户端+两IndexedDB设备往返、账号A/B/游客认领、冻结的完整旧v2客户端和新客户端切回回读通过。开始/暂停/提交本地flush失败时不提前揭示正文/结果，重试保持ID。云端生产往返待发布后单独验证。

## 3. GitHub集成
任务提交及main集成待本轮提交。2026-09-24T03:45:36Z远端main为 `0526d23132afbc02f5812aea338cce4a8c85e74f`。不包含共享根目录未提交文件，不使用force push。

## 4. 发布包与正式部署
当前准备发布，尚未生成新的releaseId或切换生产。当前accepted为 `20260923T161000`，parent `20260923T150500`，source `aeba5ab75060feb7b0bb122072e60ee4eeb67547`。后续从干净集成worktree审查实际delta并调用稳定 `/opt/context-reader/bin/deploy-release`；父版本变更则重新整合打包。

## 5. 公网核验
2026-09-24T03:45:36Z公网与SSH current/state一致，backend为mainland_internal。现网7服务健康；最新 `context-reader-20260923T191827Z.dump` SHA通过并在隔离数据库恢复16表。`accepted-20260923T161000`镜像6bcf32b59565及父镜像546a1d511775保留。新版本功能和账号同步公网核验待发布后记录。

## 6. 失败与回滚
没有切换生产、没有回滚。浏览器实测发现并修复夜间对比度、未收藏编辑临时阅读丢失和手机菜单关闭按钮被拖动层遮挡。原生编辑确认改为站内确认，取消保留草稿。当前不存在已确认未修复的本轮关键回归；仍未执行的补充矩阵逐项标记，不冒称全部通过。

## 7. 最终版本关系
本轮源码仍在任务分支，main/生产待更新。发布后分别补充任务SHA、main集成SHA、最终main SHA、releaseId、parentReleaseId、sourceRevision及发布时间；纯文档回写与源码发布的SHA可不同，必须明确。
