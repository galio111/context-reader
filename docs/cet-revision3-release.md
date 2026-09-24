# 第三轮生产发布与逐项交付

2026-09-25：A—F实现已合入并正常推送main，稳定发布入口接受第三轮版本，公网身份与服务器一致。实现已上线；真实浏览器及数据回归已执行，完整人工组合并非全部通过。最终视觉认可仍由用户反馈。

## 准确发布身份

- 上线源码/部署前main：`f87313909b3d3d12820ec5f07af7d9d9e47a1c10`。
- releaseId：`20260924T184912`。
- parentReleaseId：`20260924T041127`。
- 公网`/api/connectivity`：`mainland_internal`及以上release/parent；服务器current解析到对应版本，manifest source与上述SHA一致。connectivity没有source字段。
- 发布后验收文档另行提交main；最终main会高于生产source，差异只允许docs。最终40位main在交付回复及本机`artifacts/cet-revision3-release/final-main.json`记录，不声称文档提交也已部署。
- 独立干净集成树从接受的生产来源累计，精确39文件差异；稳定入口锁、父版本复核和所有保护契约保持。只重建app/caddy，数据服务未重启。

## R01—R16

|要求|主要修改文件|实现与实际证据|未验证范围|
|---|---|---|---|
|R01 开始页工具|CetReader.tsx、ReaderView.tsx|开始页无重新练习，工具按账号权限可用；本地和公网实际开始页已观察；开始自测后含暂停仍禁辅助，提交后恢复|所有账号/既有面板组合|
|R02 禁用提示|ReaderView.tsx、ReaderToolbar.module.css|去掉重复常驻消息，保留局部tooltip/guard；真实自测暂停连续点击20次无叠加，Escape隐藏|全部键盘入口和故障组合|
|R03 四工具|ReaderView.tsx、ReaderToolbar.module.css、cet.css|宽屏计时/答题卡/提交/Menu同排，窄屏两行；11尺寸中心命中且无横向溢出；1023/1024/1025、1279/1280/1281检查|原生125/150%缩放|
|R04 全历史|CetReader.tsx|默认全部真题，跨级别/材料；本地两套练习+独立自测，同一套卷仅一条；生产整卷提交后全局历史正确|跨账号迟到同步全人工矩阵|
|R05 目录布局|CetLibrary.tsx、cet.css、cetLibraryView.ts|1320版心，宽屏双列+250px右栏，窄屏移下方；1440实测，游客每级六套生产复验|全部长标题/大量历史组合|
|R06 连续目录|CetLibrary.tsx、cetCatalogueLoader.ts|分批元数据12条、连续加载、取消过期请求、失败保留已读；本地真实25/25与28/28，56篇仔细阅读末项可进入；生产认证API总数25/28|公网登录目录末项未通过UI重跑；异常网络主要由测试验证|
|R07 提交全部|cetPracticeSubmitAll.ts、CetReader.tsx|先保存/flush再展示结果，固定题目范围和幂等操作，旧结果不变，非法空/重复/未知范围拒绝；真实4篇1/30及单篇0/5；公网空30题一次确认得到0/30、4/4、固定01:27|所有断电/跨账号竞争真实人工组合|
|R08 夜间配色|globals.css、PillNavAction.tsx、ReaderToolbar.module.css、cet.css|修复span规则压过胶囊配色；实际tooltip/hover/disabled对比度10.88/8.80/6.65；真实截图浅底深字、禁用可读|每个控件全部loading/error/focus组合|
|R09 图片横移|HomeRedesign.tsx/.module.css、useArticleReveal.ts|新增固定裁剪外框，保留内部原.9→1缩放和3D；230帧外框x/宽恒定；公网切回外刊前三张preview与高清均加载，外框transform:none|Mac/物理触屏/原生缩放、全部冷缓存动效组合|
|R10 点击遮挡|HomeRedesign.module.css|透明父层不拦点击，仅真实按钮接收；旧hit stack定位brandCluster；修后真实点击时事/科学切换，公网科学aria-pressed=true|全部叠层×缩放组合|
|R11 标题摘要|HomeRedesign.tsx/.module.css、useArticleSummary.ts|复用已有summary，标题悬停延迟220ms、退出120ms，保留原卡片键盘入口；实际320px摘要截图|全部边缘/缺摘要/触屏组合|
|R12 每日提示|useDailyPublicationNotice.ts、dailyPublicationUpdates.ts、daily-updates/route.ts|上海日×账号×本浏览器去重，独立轻量统计，可见累计2000ms；真实两浏览器首次样本约2秒、重复不显示；生产计数接口200|真实跨账号/午夜/隐藏/存储拒绝完整矩阵|
|R13 粒子字标|FallingWordOpening.tsx|按测量字宽单双行，字形边界采样、1800粒子上限、8布局缓存及静态降级；390真实双行可读|全部临界字宽/DPR/字体故障；reduced-motion尝试超时未验|
|R14 嵌入说明|GuidePageContent.module.css|按容器宽度排版，保留正文/FAQ/Anki；11尺寸无溢出，1024嵌入661/正文633；公网960面板943、核心正文636.6，目录真实跳转及截图|独立页/所有长URL、弹层全矩阵|
|R15 三点等待|AccountProvider.tsx、FallingWordOpening.tsx、startupPerformance.ts|账号请求和本地存储独立准备并行，读合并仍等待存储；每组3次冷/热/受限网/CPU4x开发浏览器测量已记录|没有生产性能前后对照或任意网络低延迟保证|
|R16 发布验收|tests、package.json、docs|当前源码自动回归、干净构建、治理部署、公网实际Reader/首页/说明及真实账号API验证已完成|以下明确未验项；不以API代替视觉|

C01按本包的“右侧工程默认”实施，不写成用户此前已一致确认。

## 回归与生产证据

- 最终CET39/39，关键89/89，针对回归17/17，供应商/配额12/12，用量7/7，封面预览动效1/1；TypeScript通过，lint0错误41警告，9保护契约和出口审计通过。任务树、干净集成树及服务器生产构建通过。未改供应商/配额/依赖锁/数据库/题库，不靠削弱保护断言过关。
- 本地实页使用真实HomeClient/ReaderView，只有公开元数据后端fixture；本地身份不冒充生产登录。“今日2篇”fixture不是生产数量。
- 本地练习26题D→1/30、4/4、固定02:08；再次独立自测初始0/30、暂停隐藏正文及锁辅助，提交0/30、00:16并记录曾中断。跨级别历史保留。题型末项2022年6月六级第2套仔细阅读2单独提交0/5、1/1、00:17。
- 公网960×900/DPR1真实开始页→整卷练习→一次提交确认30题/4篇→0/30、4/4、固定01:27→全部真题历史一条整卷；回首页保持六级选择，切外刊图片加载，实际科学分类切换；Menu内使用说明核心功能真实目录跳转。该标签页错误日志为空。
- 上线后独立合成账号会话、匿名同步401、匿名Admin数据401、认证目录25/28、每日统计200通过。三种AI调用实际再次执行（语境解释含句译、独立词典、两块全文译文），服务端六条前后调用均deepseek-flash、每动作quota_units=1。恢复Admin会话/只读通过，不等同正常active-admin全UI验收。
- 真实protocol-2客户端在两个独立IndexedDB环境对生产同步：正计时暂停30秒、完成40秒，答案/结果不变，冻结旧v2客户端回写后v3和普通文章保留，无tombstone。它是数据验证，不是浏览器布局证据。
- 健康检查通过；最新备份`context-reader-20260924T192201Z.dump`SHA及隔离16表恢复通过；当前镜像8ce5a2a6a39e…、父镜像cfeb46b05f33…存在。没有实际执行回滚，不称回滚演练通过。
- 专用账号48aa2f08-c83f-41e6-9e61-75b7be48e30a按id/昵称/创建日精确清理，复核404、同步对象0。未清理其他账号或用户数据。
- 浏览器截图已在本任务工具记录展示；未导出成独立PNG文件，不能提供虚构截图文件路径。本机日志、HTTP证据与发布包在`artifacts/cet-revision3-release/`，其中私有凭据不得提交或公开。

## 未验证项及限制

`cet-revision3-acceptance.json`保留79条产品与8条发布检查各自状态。partial表示只完成其中明确的证据，不代表该条全部通过。Mac/Safari及物理触屏无资源；125/150%快捷键未真正改变CSS viewport/DPR；reduced-motion浏览器调用超时，已撤销限制；全账号/午夜/存储拒绝/故障/控件状态组合尚未全部人工走查。Chrome临时CPU/网络/缓存限制已恢复。公开截图仍需用户最终视觉认可。

这次发布不宣称所有图片零等待，也不将开发构建的启动样本当作生产优化幅度。详细尺寸、动效帧和分段性能样本见[cet-revision3-progress.md](cet-revision3-progress.md)。
