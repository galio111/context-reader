# 架构优化的独立基线

本目录由独立功能审计 agent 创建；作者不编写本轮重构业务实现，也不以实现者缩小范围的意见删功能。它固定接受生产源码 `4d0d91106087951d8d4271b46a328c0908f869d3`（release `20261012T135500`，parent `20261010T223500`），不是候选版实现的事后说明。

| 文件 | 用途 |
| --- | --- |
| [functional-contract.md](functional-contract.md) | 100项有编号的全站功能/界面/异常/数据契约，12个领域，明确源码事实、文档冲突与未观察项 |
| [coverage-matrix.md](coverage-matrix.md) | 121个独立可观察验收场景及针对本轮仓库/编译/翻译竞态的补充要求；默认全部未运行 |
| [route-index.md](route-index.md) | 78个API、12个页面的快速阅读索引 |
| [route-inventory.json](route-inventory.json) | 方法、字段/操作分支、鉴权/限制/响应行号、源码hash；不能代替共享校验器 |
| [test-inventory.json](test-inventory.json) | 108个测试/SQL/fixture文件及可解析测试标题；不是通过报告 |
| [source-baseline.json](source-baseline.json) | 544个实现/类型/样式/测试/配置/middleware/PWA文件hash，便于精确比较 |
| [static-data-inventory.json](static-data-inventory.json) | 217个仓库data/CET媒体文件的尺寸和hash；没有导出真实用户数据 |
| [state-inventory.json](state-inventory.json) | 存储key/事件/schema/RPC的源码证据索引；不是完整DB schema dump |
| [build-inventory.py](build-inventory.py) | 只读枚举源码并生成上述JSON/index的可复现脚本；如实现相对基线变动会拒绝重标成基线 |

本次审核对入口、类型、关键handler/state/guard和相关现态文档进行了独立交叉读取；库存脚本机械枚举其余文件与路由。没有声称逐字人工审查每行，也没有调用收费模型、修改生产数据、听音或完成浏览器全站验收。文档里的“应保持/通过条件”不是已经执行结果。

源码读取揭示了需要避免的文档漂移：桌面首页词典实际可拖动和resize；预发布翻译/摘要首次交付有登录/点数门槛；Anki UI退休但数据保留；新强密码与旧PIN并存；CET音频自测无暂停/seek，实际没有专用倍速/音量UI；usageActions导出当前最近10000条。详见功能契约1.1节及相应领域。

路由安全不只位于route.ts：还需 `middleware.ts`→`lib/requestSecurity.ts`、`userAuth.ts`、`adminAuth.ts`、`studyAuth.ts`及数据库RLS/服务RPC共同判断。某route库存没有本地origin行，不等于没有全局同源校验；反过来文件名为admin也不证明已鉴权。

文档校验已完成：JSON可解析、route数量与源码文件一致、每route都有导出HTTP方法、100个契约编号都被矩阵引用、文档相对链接有效。未运行生产构建（纯文档/库存交付）；实现和测试agent应在自己的候选commit上执行必要构建与发布门槛，另存准确结果，不改写本基线的未验证含义。

没有业务/UI/CSS/数据库/部署变更包含在这份审计交付中。它可以通过提交合并进入累计集成树；不可把工作树目录覆盖到另一任务。
