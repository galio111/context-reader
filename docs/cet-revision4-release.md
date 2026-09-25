# 第四轮实现及发布验收

状态：2026-09-26 北京时间已正常推送 main、完成稳定发布入口部署与公网关键业务验收。公开站点和服务器 current/state 一致：

- releaseId：`20260925T163006`
- parentReleaseId：`20260924T184912`
- production sourceRevision / main 代码集成 SHA：`b6c64c6e089481c0153cdc0f48c805cf7c08528f`
- backendMode：`mainland_internal`；acceptedAt：`2026-09-25T16:35:37.376463+00:00`。
- 本记录及截图随后以仅文档提交推送 main；最终 main 与生产 source 可不同，应用源码一致。最终远端核对存于本机 artifacts/cet-revision4-release/final-release-evidence.json。

以下未验证范围仍保留，不将上线等同于所有 80 项设备/故障组合通过。

|需求|实现与实际证据|未完成验证范围|
|---|---|---|
|R01 同题型路线|全可访问目录元数据；单篇保持5题答卷，路线1/56；三材料模型与分页加载测试|全权限变化/年份组合人工矩阵|
|R02 有效留痕|答案/成功辅助/提交才留痕；真实A查词→B2/56→回A；旧证据按需适配、清空不抹痕|旧v1无归属或无原事件时间不猜造；全部旧记录人工组合|
|R03 导航与失败|先保存暂停、目标固定重试、原活动恢复、owner检查、按篇本机滚动；失败恢复练习计时|全部网络/存储失败和异步切账号真实页面组合|
|R04 计时菜单|右键和更多同菜单，归零确认、倒计时输入、Escape；真实暂停归零继续|全部菜单位置和触屏长按组合|
|R05 计时兼容|v4独立命名空间与累计值/epoch；90+30=120、倒计时重置、终态及旧端兼容测试；真实云端两会话|全部断电与UI失败重试组合|
|R06 字典旧会话|先复现删后迁移恢复缺陷；owner迁移标记、稳定旧时间、近期/更多删除入口|全部历史数量/检索变体UI组合|
|R07 跨会话删除|删除/查询因果事件；真实中文删后刷新仍无、缓存保留、重查唯一；生产API两会话回放|物理多设备及所有离线竞争UI组合|
|R08 右窗布局|复用真实Reader，练习top132保留标签，自测top80，桌面/窄屏多尺寸几何|所有DPR/原生缩放组合|
|R09 同份答案|正文/右窗共用QuestionSurface；仔细阅读双向、匹配重复段、填空重复拒绝/清空释放均真实验证|全题库逐题人工验收不做泛化保证|
|R10 同份命令|两面共用QuestionActions/提交锁；真实右窗整卷提交4/4、30题，一条历史；另会话确认四快照|全部真实断网/双面极快并发提交组合|
|R11 生命周期动效|自动展开一次、工具切换收起、暂停立即隐藏；固定入口鼠标/键盘各20轮、reduced-motion零动画|未取得精确0/25/50/75/100%关键帧；用户最终观感待确认|
|R12 真Reader响应式|独立滚动/底部移动sheet；390×844及768—1920多断点无横溢；夜间/查词句译实际通过|无macOS/Safari/物理触屏实机；原生125/150%未验证|
|R13 发布|专用累计worktree正常推送main；稳定入口42文件精确差异/父版本/保护校验通过；公网真实UI、数据、AI单次扣量及健康备份通过|没有实际执行回滚；完整设备/故障矩阵未全覆盖|

## 实际测试与证据

- 61项CET、89项关键回归通过；lint0错误42警告。模型与JSDOM事件测试仅证明各自边界，不当作真实Reader布局证据。
- 本机3195为3194正式构建代理真实生产API，仅使用专用合成账号。UI不是mock Reader；首页SSR未配置真实后端，不将其视为公网首页证据。
- 真实全卷提交0/30、未答27、4/4篇、累计04:31；匹配双题原答案A保留。真实云端另一独立IndexedDB读回四份快照共30题。
- 真实生产protocol-2：v4调整后40秒快照、旧v2客户端回写、普通文章保留、路线事件、删除前查询被拒绝/明确新查询恢复唯一项。数据验证不是跨物理设备视觉验证。
- 截图/日志目录artifacts/cet-revision4-input：desktop-selftest-result.png、mobile-question-dock.png、submit-all-result.png、global-history.png、dictionary-requery.png、night-dock.png、reduced-motion.png、responsive-geometry.json、dock-keyboard-repeat20.json、dock-mouse-repeat20.json、production-real-client-sync.json。凭据qa-private.json不得提交。
- 首次快速点动画中移动的关闭按钮未命中；改用固定入口实际鼠标20轮通过，不能把首次失败记录抹去。
- 服务器健康、最新备份SHA和隔离16表恢复通过，当前accepted-20260924T184912与父accepted-20260924T041127镜像存在；未实际执行回滚。

完整逐条状态见cet-revision4-acceptance.json。partial保留真实范围；没有声称80项所有设备/故障排列全覆盖。发布授权、治理、公网版本和关键链路均已核验；partial项目仍需按其具体范围继续补验。

AI与缓存补验：真实全文翻译三段完成，重开题窗/切回翻译保留结果。服务端standalone_dictionary、word_explanation、full_article_translation各仅一次deepseek-flash成功执行，quota_units均为1；恢复Admin只读通过。更多计时命中区域补足44×44，最终构建日志另存build-final.log。

## 公网上线后实际验收

- 新版重新加载后：右窗46题选A，正文立即同选；正文47题选B，右窗同选。右窗提交全部弹窗显示28题未答、全部4篇；提交结果为答对1/30、未答28、已完成4/4。另一独立IndexedDB会话通过真实生产protocol-2读取本次活动四份快照共30题，活动ID见证据JSON。
- 新自测选C→暂停，两处题目立即隐藏；暂停菜单归零后00:00，继续自测C答案保持；保存并离开正常。未修改已提交快照。
- 公网词典“我崩溃了”删除→关闭→刷新→重开，历史计数0、缓存释义仍存在；明确重查后恰好1条。未清任何缓存掩盖迁移问题。
- 公网390×844、768×1024、1024×768、1280×800、1440×900、1920×1080均实测无横溢；390底部题目面板目视约48dvh。public-responsive.json中的dock字段仅测桌面class，手机没有该class，不能把缺字段当作手机无题窗。截图另证手机底部面板。
- 普通外刊正常进入真实Reader，没有题目窗入口；真题切回外刊后样本高清图naturalWidth1250，预览256，均complete，原3D变换仍存在。此项只证明样本及切换，不宣称全站快滚动动画观感已获用户确认。
- 公网浏览器捕获error日志为空。账号退出后游客显示四级6套。验收后恢复视口、将原预览页切至正式网站、停止仅本轮强制QA身份的本机代理。
- 新独立账号实际执行查词含当前句译文、词典、全文翻译；每种功能恰好一次deepseek-flash成功执行且quota_units=1。匿名同步/Admin受保护API均401，恢复Admin只读正常；目录四级25套、六级28套。
- 7服务健康；备份SHA与隔离恢复16表通过；新accepted与直接父版本accepted镜像均存在。数据服务持续原运行时间，常规切换仅app/caddy。
- 两个本轮合成账号分别校验ID、昵称和创建日期后精确删除，验证auth404且同步对象0。未清库、未删真实用户数据。

## 截图与可审阅证据

[桌面作答及提交结果](evidence/cet-revision4/public-submit-all.png) · [手机底部题目窗](evidence/cet-revision4/public-mobile.png) · [自测暂停](evidence/cet-revision4/public-paused.png) · [词典删后缓存保留](evidence/cet-revision4/public-dictionary-deleted.png)。

结构化证据位于[evidence/cet-revision4](evidence/cet-revision4)，含实际身份、六组视口、词典计数、生产同步快照、AI执行/扣量、权限、健康/备份与精确清理结果；不含凭据。

## 发布过程异常及额外改动

首个候选20260925T160723在npm官方源的大型编译包下载中耗时过长，尚未切换；确认只属于候选构建的容器后停止，退出137，生产保持原版本。随后仅将Docker构建的npm下载源改为国内镜像，锁文件版本和integrity校验保持，实测818包16秒安装完成。以新提交、新releaseId重新打包并完整执行稳定治理流程，没有编辑失败候选manifest或绕过检查。

未验证：macOS/Safari与物理触屏、原生125/150%缩放、精确0/25/50/75/100%动效关键帧，以及acceptance.json标为partial的完整故障/并发/权限排列；用户最终动效观感仍独立于工程通过。没有已知失败被标记为通过。
