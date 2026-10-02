# 真题历史与查词显示修复

状态：已生产部署，用户观感与物理设备验收仍开放。

接受版本 `20261003T003600`，父版本 `20261003T002636`，源提交 `3b7daaf7e3c9171ff0f9cd3c18249996d2f9eb87`，上海时间 2026-10-03 00:39:48 接受。公网 `/api/connectivity`、服务器状态与当前目录一致，后端 `mainland_internal`。保留前序首页加载、动效、付费与CET改动，仅重建 app/caddy。

- 历史：日期时间、提交答卷成绩、已提交/未提交筛选；删除结果区版本与快照提示。
- 查词：24ms显示队列，批量内容约720ms内追平；完整结果、回退、取消、低动态和缓存路径保持语义。
- 移除首段之后健康写库的同步等待；加入无原文的分阶段私有日志。
- 修复前公网样本：47/53块，首段930/411ms，全程1628/1172ms。两次均为正常流式，未复现用户具体异常。
- 验证：正式构建、发布契约、97项关键/提供商/CET事件回归、7项新行为测试、新增历史筛选UI事件；桌面与390px浏览器历史布局及筛选通过。
- 限制：真实网络或模型仍可能延迟首段；未到达的内容无法提前展示。物理手机和用户感受验收开放。

浏览器受控验证：一次性返回完整流和空流后结构化回退各出现23次可见更新，分别在718/738ms完成；输入延迟均为1000ms。临时fetch替换与观察器已移除。截图及原始逐帧证据在共享根 artifacts/history-stream-evidence/。

线上只读核对：2026-10-03 00:18前约3小时的usage_executions中，文章查词33次均为deepseek-flash流式成功，没有结构化回退记录。不能把回退路径称为用户此次故障的已证实原因。现有旧记录不含逐块时序，仍需本次新增观测定位间歇性首字/批量延迟。

## 最终验证

- 新基线累计正式构建、发布保护契约、104项关键/CET/显示队列/提供商回归均通过。
- 公网查词两次分别58/55个网络分段，首段2242/1213ms，完成3011/1964ms；服务端 gate 34/27ms、queue 0/0ms、provider 1070/1047ms，模型均deepseek-flash且完整结束。这是新样本，不是原始故障的追溯证据。
- 公网登录账号目录侧栏及Reader历史的提交/未提交筛选、日期时间、提交成绩已观察；真实历史答卷不显示版本/快照提示。实际文章查词呈现多个可见更新，结束后可复制/保存；浏览器未记录控制台错误。桌面与390px本地历史检查通过，物理触摸设备仍未验。
- 公网登录会话、protocol-2同步与Admin会话均200；匿名sync/Admin为401；真题目录200，旧首页保留查询串308跳转。
- Admin recovery只读检查全部200；七服务健康，数据库/Auth/Storage未重启。最新备份 `context-reader-20261002T152338Z.dump` SHA与隔离恢复检查通过（23张表），本版和父版回滚镜像均存在。
- 本地证据：共享仓库 `artifacts/history-stream-evidence/` 中的 final-tests.log、accepted-parent-build.log、deploy-final.log、public-stream.json、stream-server-timing.log、authenticated-checks.json、public-boundaries.json、production-operations.log、backup-restore.log、history-production.png、history-mobile.png、burst-render.json、fallback-render.json、public-render.json。

原始用户异常没有逐块日志，不能断言由网络或模型中的某一个单独因素造成。已移除首段后的健康写库等待，并统一收到内容后的显示节奏；网络/模型没有返回内容之前的真实等待不能由显示队列消除。自动审批阻止清理旧构建缓存，因此保留 `artifacts/history-stream-evidence/stale-next`；未因此修改安全规则。
