# CET revision2 生产发布记录

## 1. 授权与执行环境

用户2026-09-24以生产授权包替换旧规范，明确授权验证后合入main及部署。ZIP SHA256为 `2b0e5278a66fe38acd5f68118b6ecf6224463b1a93c4cd31d6d8fce3e850f0f3`。独立任务分支 `codex/cet-revision2` 和集成分支 `codex/cet-revision2-release`；没有从共享脏目录打包。

## 2. 功能与验收

R01–R18实现及T01–T69/P01–P08的77项实际状态见 [验收记录](cet-revision2-acceptance.md) / [JSON](cet-revision2-acceptance.json)。32 CET、89关键回归、22模型路由/跨供应商回退/用量检查通过；9发布契约及出口审计通过，lint0错误42警告，本机干净npm ci后的正式构建和服务器正式构建通过。相关扩展测试24/25，唯一外刊自动发布失败在未修改基线同样复现，未改审核逻辑或降低断言。

本机真实Windows IAB检查了共享Reader单词/跨行/反向拖选及完整原句译文、查词后20次单击题卡、按篇/整卷提交、正计时暂停刷新恢复、一分钟倒计时到期、1440×900/390×844及日夜弹窗、普通文章编辑跳转保护、近期阅读保留、词典、全文翻译及保存。实测追加修复未收藏文章编辑后临时记录被清除、手机Menu拖动层挡住关闭按钮和夜间对比度。

**公网视觉复验未完成**：正式站浏览器连续超时，未拿到本次生产截图；不把本机截图或HTTP200冒称公网视觉通过。macOS实机、物理触屏及清单里标注的补充矩阵未验证；P06部分通过，用户最终视觉确认仍开放。

## 3. GitHub集成

任务提交 `94f91cd` 与换行规范化提交 `9682ee7d2f33301edf0f9116ca556266a5740c83` 已推送任务分支。集成从接受生产源码 `aeba5ab75060feb7b0bb122072e60ee4eeb67547` 开始，保留远端main `0526d23132afbc02f5812aea338cce4a8c85e74f`，再快进合入任务。普通推送 main 到 `9682ee7d2f33301edf0f9116ca556266a5740c83` 后 `git ls-remote origin refs/heads/main` 匹配；无force push。

源码集成SHA = 生产sourceRevision。发布后另提交本文件及相关纯文档证据；最终main SHA在最终交付和本机 `artifacts/cet-revision2-release/final-main.json` 记录。该最终main与部署source之间只能有文档差异，不能把文档提交声称为新生产源码。

## 4. 正式发布

- 生产：https://context-reader.com/
- releaseId：`20260924T041127`
- parentReleaseId：`20260923T161000`
- sourceRevision：`9682ee7d2f33301edf0f9116ca556266a5740c83`
- acceptedAt：`2026-09-24T04:18:08.603377+00:00`（北京时间12:18:08）
- 精确审查差异44文件；`package-release.py`从干净源码打包，稳定 `/opt/context-reader/bin/deploy-release` 验证锁、父版本、delta、保护契约和候选站点后接受。
- 仅重建app/caddy；PostgreSQL/Auth/REST/Storage/内部网关继续原运行时间。高清外刊封面、预览和3D动效文件保留。

## 5. 公网、账号与服务核验

公网 `/api/connectivity` 返回 `20260924T041127` / `20260923T161000` / `mainland_internal`；此API没有source字段，source通过服务器state/manifest核对。`/opt/context-reader-current`指向准确发布目录。游客四级/六级各六套、单卷四篇材料身份和答案解析、登录后25/28套目录通过；匿名同步/Admin/超范围旧卷401、普通账号非Admin通过。真实查词含句译、独立词典、两段完整上下文翻译成功；服务器usage_executions确认为deepseek-flash，三个独立action各quota_units=1。恢复Admin会话与受权读取通过；未修改路由/配额。

真实生产protocol-2客户端+两个独立IndexedDB环境验证v3正计时提交40秒、v2记录和原普通文章往返保留；冻结完整v2客户端回读后，新客户端再次打开结果不丢失且无tombstone。旧CAS写入409拒绝通过。专用账号按精确id/昵称/创建日期删除，确认用户404、云端对象0；不清理他人数据。

七服务健康；`context-reader-20260923T191827Z.dump` SHA校验及隔离恢复16表通过。当前accepted镜像`cfeb46b05f33`和父镜像`6bcf32b59565`存在。未购买基础设施、未迁移数据库、未重启数据服务。

## 6. 回滚与未验证范围

没有发现需回滚的本轮核心回归，**未触发回滚，也未声称执行回滚演练**。回滚目标为已接受父版本 `20260923T161000`，遵循release-governance稳定恢复流程；镜像和备份已检查。正计时独立v3命名空间不批量改写v1/v2，旧客户端兼容通过自动测试及真实生产往返验证。

公网视觉连接失败和macOS/触屏缺失属于明确未验证范围；相关文章扩展基线失败独立记录。所有“部分通过/未验证”保留在逐项清单，没有将全部项目勾为通过。

## 7. 证据位置

根工作区 `artifacts/cet-revision2-evidence/`：本轮本机截图、选择请求证据、集成build/CET/critical/lint/AI契约日志；`artifacts/cet-revision2-release/`：release-identity、changed-files、deploy.log、public-evidence、server-evidence、production-real-client-sync、production-ai-evidence、production-usage-admin、backup-restore、cleanup-evidence与final-main。私有验收凭据不进入Git、生产包或报告。
