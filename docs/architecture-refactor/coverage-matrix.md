# 独立功能一致性验收矩阵

基线与功能编号见 [functional-contract.md](functional-contract.md)。本表由功能审计 agent 制定，独立于实现者。**本文件没有执行结果，所有场景初始状态为 U（本轮未运行）**；源码/测试文件存在不能填为通过。独立测试者应另附结果记录，保留 baseline 与 candidate 的准确SHA/release、账号类型、视口/主题、缓存/网络状态、测试时间、断言/截图/trace路径、pass/partial/fail及未覆盖范围。

P0 是本轮发布必要路径或数据安全/授权底线；P1 是全功能一致性审核的一部分。未修改域可以通过源码/数据hash未变缩小回归范围，但仍不能宣称这些域已逐项完成动态验收。新增实现单元测试与本表的真实交互互补，不能互相替代。

## 状态、数据和图像准备

- 身份至少含 fresh guest、guest池耗尽、Free可用点/耗尽、invited、Admin、停用账号、上次账号离线、两个独立账号和两个独立浏览器会话。不得使用真实用户数据做破坏性fixture。
- desktop固定1440×900；mobile固定390×844，另375窄屏/900断点两侧；日/夜，keyboard，reduced-motion，动效开/关。使用相同字体ready、同账号/文章/图片/scroll位置。
- 文章夹具含plain、短rich、有空段/表格/list/sup/sub/图注、无图/封面only/bodyonly、10k+词长文章、同词不同句、同句重复出现、50k字符以上、source不存在/发生编辑。
- 存储夹具含旧JSON/lz-utf16、IndexedDB已迁移、旧tab晚写、1200条dictionary history、20000以上已同步explanation、pending未上传、相同id冲突、删除tombstone、帐号A→B切换中的异步回包。
- 网络夹具含正常、延迟、429、503、连接中断、成功HTTP但空/畸形模型正文、response chunk任意切分、取消与完成竞态。真实收费/DB用隔离测试账号、可审计actionId与账本前后值。

## 首页、UI、导航

| ID / 级别 | 合约 | 操作与异常 | 可观察通过条件 | 现有证据入口（不等于通过） |
| --- | --- | --- | --- | --- |
| U01 P0 | G01,H01 | 访问 `/`、`/home-v2?a=1`、`/study`；匿名加 `preview=member` | 根SSR真实推荐；旧路由保query；study同面板；preview不提高权限 | `app/page.tsx`, `app/home-v2/page.tsx`, `app/study/page.tsx` |
| U02 P0 | G02 | baseline/candidate同数据日夜desktop/mobile截图 | 布局、文字、字型、颜色、控件尺寸/位置一致；差异有具体原因而非“重构必然” | CSS/TSX hashes, `source-baseline.json` |
| U03 P0 | G03,H07 | 初入、向下离开、向上重入、最后一张/展开36+卡；分类切换 | 所有卡0.90入场/退出重置重入；delay有界；真实image layer保持3D与高清 | `tests/home-cover-motion.test.ts`, `cover-preview-motion.test.mjs`, `critical-regressions.test.ts` |
| U04 P0 | H01,R09 | 打开A→Reader内B→页面返回首页；重走后浏览器后退 | 可见返回直达首页；browser back回A；原卡/资源/搜索/展开恢复，不重开loader | `critical-regressions.test.ts`, `HomeClient.tsx` |
| U05 P1 | H02,R09 | 临时文章晚于保存文章，再从工作台继续阅读 | 最新临时优先；公开→保存后同一归属/锚点 | `critical-regressions.test.ts`, `temporaryReading.ts` |
| U06 P1 | H03 | guest冷开hero；手机竖滑/横拖/短触；返回再进 | 文字与Ballpit层级/开场保持；仅hero明确竖滑吸附 | `ballpit-first-frame.test.mjs`, `critical-regressions.test.ts` |
| U07 P1 | H03,H04 | 展示切模块/点当前/暂停/后台/网络错；手机探索 | 视频只当前可见播放；重播/错误替代；手机无隐藏3D挂载 | `showcase-playback.test.mjs`, `FeatureShowcase.tsx` |
| U08 P1 | H04 | 桌面吊牌拖过阈值后放手、重拖、切走；keyboard/WebGL失败 | 摆动后打开真实guide；取消旧延时；静态入口可用 | `GuideLanyard.tsx`, `GuideLanyardScene.tsx` |
| U09 P0 | H05 | cold SSR+Network检查；冷目录失败后显式展开重试 | 轻量摘要无全量body；首批图片preload；失败仍可开已有卡；重试/在途合并 | `test:loading`, `public-summary-projection.test.ts`, `homepage-bootstrap.test.ts` |
| U10 P0 | H06,H08 | 保存/清偏好；排除推荐池文章；旧文编辑为今日 | 偏好改变白名单内主推；排除不回来；今日判断不用updatedAt | `critical-regressions.test.ts`, `home-resource-switch.test.ts` |
| U11 P1 | H06,H07 | 分类主推旧文+今日文；有无图混合完整库存 | 今日前置；前三行无无图卡；无图仍在展开后可找/可开 | `critical-regressions.test.ts` |
| U12 P1 | H09 | article↔CET切换、反向滚动、focus、motion off | 资源标题/导入桥同一文档流，返回恢复tab，reduce静态可见 | `home-resource-switch.test.ts`, `homepage-bootstrap.test.ts` |
| U13 P1 | H07 | 今日更新notice同账号重复打开、跨日、换账号 | 按上海日/owner/session现有规则去重且累计可见时长 | `daily-publication-updates.test.ts` |
| U14 P1 | H10,H11 | Menu每子页、返回、关闭重开；mobile点生词+滚动 | 详情完整、返回不失状态；scroll不误点击；所有原入口保留 | `HomeOptionMenu.tsx`, `critical-regressions.test.ts` |
| U15 P0 | H12 | 桌面词典拖动/resize/关闭再开；390px旋转/软键盘 | 实际拖/缩放保留，手机独立48/25/82规则，控件不离屏/被遮 | `critical-regressions.test.ts`, `mobile-sheet-gestures.test.tsx` |
| U16 P0 | G04 | tab导航/Escape/focus-return、输入选字、所有可见mobile控件center hit | 可操作、焦点合理；正常输入选择；44px且实际命中按钮 | `critical-regressions.test.ts`, browser hit-test |

## 导入、长文、编辑、阅读状态

| ID / 级别 | 合约 | 操作与异常 | 可观察通过条件 | 现有证据入口 |
| --- | --- | --- | --- | --- |
| R01 P0 | R01,A04 | guest/会员paste成功、空白/失败/池用尽 | 成功读同文，空白前置拒，正确pool且失败不charge | `/api/usage/guest-import`, `HomeClient.tsx` |
| R02 P0 | R02 | URL成功/超时/不支持/paywall/私网/重定向 | 成功直接Reader；输入保留/可paste fallback；私网拒绝无内网请求 | `overseas-fetch-contract.test.ts`, `substack-extraction.test.ts` |
| R03 P0 | R02,R03 | URL含实体/重复标题/重复caption/链接figure | 内容和来源日期准确；只去精确重复，不丢真实figure/正文 | `publisher-media.test.ts`, `substack-extraction.test.ts`, `critical-regressions.test.ts` |
| R04 P0 | R03,R05 | paragraph/list起号层级/table/sup/sub/caption夹具编译渲染 | 块序、文本、block id、token id/offset/上下文完全对照；表格局部横滚 | `critical-regressions.test.ts` + compiler differential tests |
| R05 P0 | R05 | 长文滚到底再顶、源跳转很深、连续快速滚 | 远块普通text，近块交互，离窗回收；主线程/内存无全树增长 | `critical-regressions.test.ts` + browser performance trace |
| R06 P0 | R06 | desktop点击/跨块短语；mobile纵滑/横拖/长按/cancel | 选择及完整上下文正确，纵滚不误查，token跨块唯一 | `latin-lookup.test.ts`, `critical-regressions.test.ts` |
| R07 P0 | R09 | 快速扫描退出、稳定停留退出、编辑后reopen | 快扫按既定重启top，稳定锚点恢复；不被异步图片/旧state拉走 | `critical-regressions.test.ts`, `readingProgressPolicy.ts` |
| R08 P0 | R10 | 从当前/已保存/未保存public词源跳转；来源缺失 | 精确句/词高亮及lastOpened；找不到诚实提示；不扫描/唤醒全部长文 | `critical-regressions.test.ts`, `sourceMatching.ts` |
| R09 P0 | R11,R12 | 原位编辑空段/表格/删图→保存→undo→redo→取消→再开 | 文本与block同基线；保存不清历史；取消恢复；scroll像素不跳 | `article-management-regression.test.ts`, `critical-regressions.test.ts` |
| R10 P0 | R13 | 普通/已有摘要/50k+文章保存；summary quota/model失败 | 文章先存；只first-save metadata；已保存禁用；失败不丢正文 | `article-management-regression.test.ts`, `critical-regressions.test.ts` |
| R11 P1 | R14 | 字体/字号/行距/段距/内容/图片宽、主题切换 | 所有选项持久/按现有范围有效；工具不清上下文 | `types/article.ts`, `ReaderView.tsx` |
| R12 P0 | R15 | 空sheet/结果top/bottom内部wheel/touch；上方article滚 | 内部不串正文；露出正文仍可滚；resize/close无遗留scroll锁 | `mobile-sheet-gestures.test.tsx`, `critical-regressions.test.ts` |
| R13 P0 | R15 | 慢拖停25、越界、快速28px甩、停80ms后放、cancel | 分别停留/关闭/关闭/停留/恢复；reopen初高 | `mobile-sheet-gestures.test.tsx` + physical gesture |
| R14 P1 | R04 | 快冷滚图→开viewer→不同光标位置zoom→reset/download | 原图清晰/实际及时paint；锚定像素正确；失败fallback | `publisher-media.test.ts`, `critical-regressions.test.ts` + browser/audio-free visual |
| R15 P0 | R01,R09 | 未存文章home按钮/browser back/嵌套Reader离开 | 每条已有确认路径保留；取消继续原文；确认只丢指定temporary | `critical-regressions.test.ts` |

## 解释、词典、发音、翻译

| ID / 级别 | 合约 | 操作与异常 | 可观察通过条件 | 现有证据入口 |
| --- | --- | --- | --- | --- |
| L01 P0 | L01,R07 | signed-in上下文单词/短语→完整流→保存→刷新replay | default Flash，完整句翻译和IPA，流/完成/缓存字段一致，一action charge | `model-routing.test.ts`, `provider-billing.test.ts`, live ledger |
| L02 P0 | L01,L02 | 强制retryable primary失败→独立Zhipu fallback | 一用户charge，多provider execution可审；不能Flash/Pro互换 | `provider-failover.test.ts`, `provider-billing.test.ts`, live forced fallback |
| L03 P0 | L02 | stream任意切chunk/半JSON/末尾无换行/缺IPA/HTTP200空content | 正确repair或错误，不假成功；不重复扣费，不丢末段 | `critical-regressions.test.ts`, `quota-diagnostics.test.ts` |
| L04 P0 | L02 | 快开关/换词/先cancel后register/旧回包迟到 | 正确abort/refund，无故障邮件、无旧结果覆盖新选择 | `critical-regressions.test.ts`, `provider-failover.test.ts` |
| L05 P0 | L03,L04 | apple/fell/变形/明显错拼/带重音词/8词短语/超限/中文多候选 | 4状态及全部学习字段；歧义不丢义；无效前置拒绝 | `latin-lookup.test.ts`, `dictionary-pronunciations.test.ts`, live dictionary |
| L06 P0 | L04,L07 | dictionary流完成→存入词本→刷新与source/regen | 内容布局一致；id/createdAt/receipt/study memory不重置 | `dictionary-result-replay.test.ts`, `dictionary-result-server.test.ts` |
| L07 P0 | L05 | 1200history点单条；关网络/删对应snapshot；看请求与账本 | 只读该条；无lookup生成/charge；缺失有显式恢复说明 | `dictionary-history-replay-ui.test.tsx`, `dictionary-result-replay.test.ts` |
| L08 P0 | L05 | delete→旧tab sync/刷新→同词手动新查；中途切owner | tombstone不复活；观察delete的新query可回归；owner隔离 | `dictionary-history-intents.test.ts`, `dictionary-history-sync.test.ts` |
| L09 P0 | L06 | record/POS同音/异音bass；UK/US点击、极速换词与重开 | 只actual IPA拆行；正确text/accent/IPA缓存；首点播放无串音 | `dictionary-pronunciation-groups.test.ts`, `pronunciation-playback.test.tsx` |
| L10 P1 | L06 | 同raw provider音频与批准reference人工听音 | 音素、重音、词形及原voice/speed一致；200不作词汇正确证据 | `pronunciation-cmu.test.ts`, raw audio + human listening |
| L11 P0 | R08 | mobile/desktop解释完成与缓存→追问→换选择 | 全context请求，答案不串选择，手机回车换行/点击提交可用 | `ExplanationPanel.tsx`, live `/api/ask-sentence` |
| T01 P0 | T01 | 打开/切工具后不点；点翻译→切词典→回来 | 未点无请求；点后task继续且进度恢复，不自动取消 | `translation-background.test.ts` |
| T02 P0 | T02 | 新生成/续传/regen发送真实blocks；只发counts非法 | 合法start绑定body version/action；非法在billing前拒 | `critical-regressions.test.ts`, `/api/translate-article/start` |
| T03 P0 | T03 | 10+blocks跨批、上游JSON跨chunk无换行/typed-key | 每有效id逐块出现按原顺序；仅translation或匹配type接受 | `article-translation-batching.test.ts`, `critical-regressions.test.ts` |
| T04 P0 | T04,T05 | 完成几块断线→retry/reopen；3轮零进度 | 真完成块持久不丢；只缺块重试；有界自动重试转人工 | `translation-background.test.ts`, runtime fault injection |
| T05 P0 | T01,T05 | 旧任务pending→force新版全成功→旧response/取消迟到 | durable cache与内存保留新generation，旧回包/finish不能覆盖 | independent runtime race test required |
| T06 P0 | T05 | 文本改一块/删除一块，force失败/成功 | 未变复用、stale明示，旧成功在新成功前不清 | `articleTranslationIdentity.ts`, `cache.ts`, regression test |
| T07 P0 | T02,A06 | first公共缓存→个人重看；partial取消/重试相同action | 登录+首次charge，个人replay free；partial精确结算/退款幂等 | `provider-billing.test.ts`, `billing-ledger.sql`, live ledger |
| T08 P0 | T06,C11 | CET题干+选项+bank翻译，旧提交包回看；保存 | 翻译文本完整、历史原snapshot，保存仅正文 | `cet-selection-translation.test.ts`, `cet-underlines.test.ts` |

## 生词、学习和画像

| ID / 级别 | 合约 | 操作与异常 | 可观察通过条件 | 现有证据入口 |
| --- | --- | --- | --- | --- |
| V01 P0 | V01,L07 | 同word不同句/同句重复加入，regen后旧receipt/memory | 正确去重/保留语境；稳定id/createdAt及兼容字段 | `vocabularyMerge.ts`, vocabulary repository differential tests |
| V02 P0 | V01,H11 | 搜索/虚拟长列表/复制/CSV/单删/清空取消 | 完整字段与数目；测高无超高空行；确认有效；无AnkiUI | `critical-regressions.test.ts`, `VocabularyPanel.tsx` |
| V03 P0 | V02 | 从三入口/study URL→卡→原文→返回/暖重开 | 同真实Panel、同张卡、来源Reader正确，不重复start | `study-presentation.test.ts`, `StudyHost.tsx` |
| V04 P0 | V03,V04 | known memory fixture各rating/retention/steps、先review后new | FSRS结果与原库相等；长期Hard不强制10min；顺序前后端同约束 | `study-scheduler.test.ts`, `study-ledger.sql` |
| V05 P0 | V04 | 跨上海日/当天补新词/复习上限改动 | 固定day plan、当天review目标不扩，新词可补，无50新词上限 | `study-scheduler.test.ts`, SQL plan fixture |
| V06 P0 | V05 | 4答案映射+原文辅助+快速确认 | rating准确；提示按Again；850ms重试沿用request id | `study-presentation.test.ts`, `study-concurrency.py` |
| V07 P0 | V05 | 保存掉网→同id重试/双设备并发旧version | 失败不丢answer或前进；幂等、CAS/server权威，无重复复习 | `study-concurrency.py`, isolated live API |
| V08 P0 | V05 | 15min内undo/超时/重复答后/已rewarded依据 | 仅合条件可撤，历史标记保留，不能reward套利 | `study-flexible-rewards.sql`, `study-ledger.sql` |
| V09 P1 | V06 | background/tool/source/空置/连续可信操作/每题>60s | 只有限有效段计时；不虚增study时间 | `study-presentation.test.ts`, `useStudyTimer.ts` |
| V10 P1 | V06 | 暂停各天数/取消确认/恢复；设置连改后网络失败 | 暂停不改memory，断streak；pending设置可重试且不回退新值 | `study-scheduler.test.ts`, `StudySettings.tsx` |
| V11 P1 | V07 | column遮挡/单格揭示/filter；30/90/365/7天/52周统计 | 都来自真实参加词；Anki pending排除；不是永久“掌握” | `study-presentation.test.ts`, `StudyStats.tsx`, `StudyVocabulary.tsx` |
| V12 P0 | V08 | 学完新词未领→领取→重复/8并发→继续学后领差额 | 达成与入账分离，只增一次，部分新词未完不阻断 | `study-claim-concurrency.py`, `study-flexible-rewards.sql` |
| V13 P0 | V08 | 删除重建同表达/换方向/改变policy | 不重复奖励；已获snapshot不改，expiry准确 | `study-rewards.sql`, `study-flexible-rewards.sql` |
| V14 P0 | V09 | 阈值/中断/每档一次；同档/异档/Admin启用会员 | streak诚实，权益不覆盖异档；月度point anchor保留 | `study-rewards.sql`, isolated SQL |
| V15 P0 | V10 | 59/60min、49/50lookup、同tab/双tab重复evidence | threshold由verified数据；跨tab不叠；idempotent evidence | `study-evidence-v2.sql`, `study-profile.test.ts` |
| V16 P0 | V10 | 点击画像成本确认/取消/模型失败/同id重试/重看/应用偏好 | 不自动charge，失败refund，重看free，应用只显式操作 | `study-profile.test.ts`, live `/api/study/profile` |

## CET

| ID / 级别 | 合约 | 操作与异常 | 可观察通过条件 | 现有证据入口 |
| --- | --- | --- | --- | --- |
| C01 P0 | C01 | guest preview/detail未授权id；member年/页快速切 | 每级12可访问，无正文答案seed；旧response不覆盖新选择 | `cet-catalogue-client.test.ts`, `cet-catalogue-loader.test.ts`, live `/api/cet` |
| C02 P0 | C02 | 全部data/cet和音频hash baseline/candidate对照 | 题目id/正文/答案/来源/录音完全不变；没有写作伪入口 | `cet-reading.test.ts`, `cet-listening.test.ts` + data hashes |
| C03 P0 | C03 | 打开start→取消→显式新practice/selftest→redo | 无空record；new id无复制答案；owner/purpose/scope分离 | `cet-activity.test.ts`, `cet-account-isolation.test.ts` |
| C04 P0 | C04 | 三阅读题型选/改/清→未答提交取消/确认 | 草稿后本地durable成功才揭；cloze正文作答无题窗 | `cet-submit-policy.test.ts`, `cet-reader-events.test.tsx` |
| C05 P0 | C04 | 一篇submitted后当前scope提交全部，其余未答 | 只未提交部分新freeze；旧快照不改；整卷单activity | `cet-submit-all.test.ts`, `cet-history.test.ts` |
| C06 P0 | C05 | selftest进行/暂停/继续/结束精读 | 辅助禁用，暂停读/划记可用不能答，精读恢复，scope不变 | `cet-reading.test.ts`, `cet-reader-events.test.tsx` |
| C07 P0 | C06 | countup/countdown、1/180/非法、refresh/hidden/back/leave | 真预算和中断标记；practice到零暂停、selftest到零freeze | `cet-adjustable-timer.test.ts`, `cet-submit-policy.test.ts` |
| C08 P0 | C06 | 计时归零/重设并重开旧v1/v2活动 | 累计时间/epoch不丢，旧条件不伪造成新模式 | `cet-adjustable-timer.test.ts`, `cet-legacy.test.ts` |
| C09 P0 | C07 | 原文/题干/选项/bank句末选区、暂停改色/删 | 位置/颜色/原text准确；blank控件除外；不推进timer | `cet-underlines.test.ts`, `cet-selection-translation.test.ts` |
| C10 P0 | C07,C09 | submit后paper override改变，再开旧历史 | snapshot原题/答案/划记不变；只读；索引正确跳 | `cet-sync-v4.test.ts`, `cet-history.test.ts` |
| C11 P0 | C08 | 跨paper题型prev/next/year直达/全部看完/换owner | route trail与activity scope独立，位置分母准确，不重随机已存在next | `cet-type-trail.test.ts`, `cet-exposure.test.ts` |
| C12 P0 | C09 | v1/v2/v3/v4 fixture双向sync/删除/同时间事件冲突 | 兼容原历史、owner隔离、immutable提交，timer/revision不回退 | `cet-sync-v3.test.ts`, `cet-sync-v4.test.ts`, `cet-storage.test.ts` |
| C13 P1 | C10 | global历史筛级别/目的/status/load30/已提交回看 | 全题库非当前卷限制，分数/日期来自freeze，窄宽布局完整 | `cet-history.test.ts`, `cetLibraryView.ts` |
| C14 P0 | C11 | 题窗/正文双向选答，切题型/上一题、cloze、自测暂停 | 同命令同状态，题窗不盖控件，不留重复答案或错误入口 | `cet-question-dock.test.ts`, `cet-submit-policy.test.ts` |
| C15 P0 | C12 | practice播放暂停seek/replay；selftest连续到end | 练习可控；自测无pause/seek/replay，lazy load，checkpoint准确 | `cet-listening-player.test.tsx`, `cet-listening.test.ts` |
| C16 P0 | C12 | audio延迟/断网/离开后恢复/blocked；答案前后transcript | 错误可恢复、interrupted条件保留、不提前原文/答案 | `cet-listening-player.test.tsx`, `cet-listening.test.ts` |
| C17 P1 | C13 | Admin编辑paragraph保存/普通用户伪造请求 | override有效、旧来源/历史不改；普通人拒绝 | `cet-inline-editor.test.tsx`, live `/api/admin/cet-paper` |

## 账号、存储、同步、计费

| ID / 级别 | 合约 | 操作与异常 | 可观察通过条件 | 现有证据入口 |
| --- | --- | --- | --- | --- |
| A01 P0 | A01 | 新注册弱/强密码、旧PIN登录、改密、手机不合法 | 新强旧兼容；无SMS/自助重置；内部email不露 | `passwordPolicy.ts`, live auth smoke |
| A02 P0 | A01,A11 | 会话rolling/普通logout后另一独立浏览器 | cookie策略一致；logout仅local session，另一设备仍有效 | `logout-session-scope.test.ts`, `critical-regressions.test.ts` |
| A03 P0 | A02,G05 | 登录时cloud慢；session查失败；恢复网络/停用 | UI可进入后台restore，离线标识清楚、no admin/no quota授权，不落guest错态 | `login-background-sync.test.tsx`, `sync-rate-recovery.test.ts` |
| A04 P0 | A03 | create邀请码→一次显示→并发两账号领→expiry/停用 | hash-only后续、一人成功、active权益不可替换、到期Free | `invitationCodes.ts`, isolated API/SQL |
| A05 P0 | A04,A05 | 4guest pools耗尽/新上海日；member耗尽/0allowance | pool独立、身份正确、reset可解释；阅读/cache可用 | `quota-diagnostics.test.ts`, `provider-billing.test.ts` |
| A06 P0 | A06 | 相同action stream+fallback+cancel/fail+retry | 一次成功收费、失败refund、execution真实记录 | `provider-billing.test.ts`, `billing-ledger.sql` |
| A07 P0 | A07 | 旧JSON/lz迁IDB、注入transaction失败、oldtab晚写 | 先备份再verified commit，失败不删legacy，原nativeStorage未覆写 | `indexeddb-reliability.test.ts`, `sync-storage-recovery.test.ts` |
| A08 P0 | A08 | pending写时A→B、old async A回包、quota exhausted | pending可恢复，B无A泄漏，不清其他localStorage | `indexeddb-reliability.test.ts`, new repository owner-isolation tests |
| A09 P0 | A09 | first protocol2大量对象分组/中断15min恢复→increment | 固定snapshot/resume、learning先、manifest/hash/CAS，非每次全量 | `sync-storage-recovery.test.ts`, `incident-sync-summary.test.ts` |
| A10 P0 | A10 | article duplicate/conflict；word+sentence重复/同id歧义 | 单canonical+tombstone，词完整merge，仅真实歧义recovery隔离 | `incident-sync-summary.test.ts`, vocabulary differential tests |
| A11 P0 | A09,A11 | 200对象/约1.5MiB上传、CAS碰撞、429/401 | bounded/ack checkpoint、最多3冲突重试、401不清数据 | `sync-rate-recovery.test.ts`, `capacity-regressions.test.ts` |
| A12 P0 | A08 | 20k+/40MiB解释cache，含unsent/文章/词汇/备份 | 仅ack explanation recency淘汰；其他完整保留 | `indexeddb-reliability.test.ts`, `learningCachePolicy.ts` |
| A13 P0 | A11 | autosync失败/手动sync/退出前sync失败 | 常规静默，手动结果在账号页；严重local失败单独警告；退出被阻止 | `login-background-sync.test.tsx`, `incident-sync-summary.test.ts` |
| A14 P0 | A12 | export后核对objects+study各collection；超bound | 包含receipt/card/reviews/rewards/claims，study超上界报错；usage10000限制如实记录 | `/api/account/export`, `studyStore.ts` |
| A15 P1 | A12 | profile edit→sync/reopen；repair-vocabulary取消/有效 | 正确字段/owner；repair不会自动删除/侵入别的词 | `/api/account/profile`, `/api/account/vocabulary-repair` |
| A16 P0 | A13 | commercial flags off/on；未配支付create；重复notify隔离 | UI跟原开关，未配不扣款、不伪成功；验证签名/订单idempotency | `billing-policy.test.ts`, `billing-ledger.sql` |
| A17 P1 | A05,A13 | 5%notice重复页面/不同账号、pricing关闭 | 3s/阈值去重；Menu原状态焦点保留；no forced读者转场 | `AccountUsagePageContent.tsx`, `BillingPage.tsx` |

## Admin、自动化、安全与发布

| ID / 级别 | 合约 | 操作与异常 | 可观察通过条件 | 现有证据入口 |
| --- | --- | --- | --- | --- |
| D01 P0 | D01,G05 | guest/member/staleAdmin/localOnly请求每Admin路由 | 真server role才允许；无key/私密内容，mutations按现有同源边界 | `route-inventory.json`, live auth-boundary smoke |
| D02 P0 | D02 | saved/paste/URL/manualcrawl建候选→Reader改正文 | 同row/完整正文，metadata留Admin，manualcrawl不publish | `article-management-regression.test.ts`, Admin browser |
| D03 P0 | D03 | 未审cover/不安全image/正文版本冲突/有效publish | 门槛正确拒绝；valid存WebP并公开Reader回放；无stale overwrite | `admin-curation-body-limit.test.ts`, `publisher-media.test.ts` |
| D04 P0 | D04 | published toggle失败/成功、candidate toggle、换singleton | 即时persist/失败rollback；candidate draft，单例原子 | `critical-regressions.test.ts`, `admin-curation-body-limit.test.ts` |
| D05 P1 | D05 | cover-only/body-only/text-only和synthetic；publication date | 四态/原来源时间一致；repair同图幂等不造图 | `publisher-media.test.ts`, `critical-regressions.test.ts` |
| D06 P0 | D05,T06 | published上传fullcache/不完整/旧版本；candidate | 只valid当前完整成功，旧拒绝；无candidate翻译入口 | `critical-regressions.test.ts`, Admin live cache upload |
| D07 P0 | D06,D07 | sourceenable/rights、手动+timer lease、预算上限 | bounded、只enabled验证来源；无重复run或越budget | `discovery-policy.test.ts`, `editorial-runtime.test.ts`, `test_editorial_scheduler.py` |
| D08 P0 | D07,D08 | 抽取短/污染/图片错/401词/审核缺usage/空content | 技术待处理与内容拒绝/policy skip分开；不误publish/漏计unknowncost | `editorial-intake.test.ts`, `editorial-review.test.ts`, `editorial-efficiency.test.ts` |
| D09 P1 | D08 | RSS移出/1h6h失败/5000队列容量/人工requeue | 未处理不消失、retry有界/inspection可见，requeue门槛仍在 | `editorial-intake.test.ts`, `editorial-recovery-policy.test.ts` |
| D10 P0 | D09 | 全日运行/同日resume/补发→收尾重入两次 | 五组今日先、白名单不扩、同receipt不重排、零modelcost | `editorial-shuffle.test.ts`, `editorial-completion.test.ts` |
| D11 P1 | D09,D10 | report失败/SMTP accepted、scheduled/recovery/backlog成本 | durable ledger仍有，邮件状态不冒称inbox，费用phase准确 | `editorial-budget.test.ts`, `editorial-repair.test.ts`, `admin-usage-report.test.ts` |
| D12 P0 | D10 | model更改/无key/probe429/primary失败/unknown usage | 路由guard、独立fallback、费用/execution分账，secret不下发 | `model-routing.test.ts`, `provider-failover.test.ts` |
| D13 P1 | D11 | plan/status/quota/bonus/invite/study policy改变 | 审计记录、已授snapshot不回改、停用后服务器拒绝 | Admin panels/APIs, `study-policy` SQL |
| D14 P0 | D12,O01 | feedback3图/4图/坏格式/大文件；Admin读/删附件 | 验证/限流，private不可匿名，删除同步移附件 | `/api/feedback`, `/api/admin/feedback` |
| D15 P1 | D12,G06 | site/provider fault vs network/input/cancel | 私密详错/trace保存、合适告警、普通用户generic可行动 | `critical-regressions.test.ts`, error report routes |
| O01 P0 | O02 | SW旧版→fresh网络但cache.put失败；offline导航/detail | fresh不被旧cache覆盖，root离线可用，有界TTL，不缓存账号API | `public-catalogue-cache.test.mjs`, `indexeddb-reliability.test.ts` |
| O02 P0 | O03 | br/gzip/identity+ETag、非法static路径 | 内容相同、协商/Vary正确，不能目录穿越 | `static-encoding.test.ts`, `test:media` |
| O03 P0 | O04 | 私网DNS/redirect/巨大响应/海外relay私密请求 | 安全阻断，pinned bounds保持，无账号cookie/AI/Storage经relay | `overseas-fetch-contract.test.ts`, release contracts |
| O04 P0 | O05 | production external backend env启动、connectivity公开 | external拒启，mainland_internal，无secret；Auth/sync经内部gateway | `verify:release-contracts`, live connectivity |
| O05 P0 | O06 | package reviewed delta/parent stale/稳定deploy入口 | dirty/stale拒绝，manifest==exact clean commit+parent，全局lock保留 | `ops/mainland/package-release.py`, release contracts |
| O06 P0 | O06 | 切版后公网+signed-in核心三功能+fallback+7服务/backup/parent | exact release/parent/backend；真实账本/功能证据；可恢复父版 | release-governance, independent deployment report |

## 本轮架构变更的针对性附加验收

总负责人已说明候选优化集中于 Reader document compiler、翻译记录仓库/运行策略与词汇仓库。它们应额外接受下列独立断言，不需要改变原 UI 来证明模块边界成立：

1. **单遍 Reader 编译**：旧parse和新compile对plain/rich/table/caption/list/inline fixture输出语义深等；所有token offsets、sentence/neighbor和block id一致；输入切换不共用陈旧memo；长文来源跳转/滚动保持原可见内容及height。
2. **词汇仓库快照**：重复read返回稳定引用但不能被消费者修改污染durable数据；writer/跨tab/account merge确实失效缓存；替换storage adapter或owner时绝不把A的entries复用到B；no-op不引发昂贵全序列化；真实变更事件保留。
3. **翻译记录仓库**：单条读/写不重新解压/写完整collection；legacy迁移保留所有记录/metadata；版本/cache-key/删除/逐块更新语义一致；IDB失败和owner切换可恢复，不强制删备份。
4. **翻译运行时策略**：每文章版本只一个有效generation，取消/旧transport迟到不能覆盖已经完成的新generation；强制再生期间原成功结果仍可见；subscriber unmount不等于取消后台job；abort不误finish charge、不抛未处理异常。
5. **可测性能**：相同输入下记录parse/lookup/scanned objects/serialized bytes/JS主线程耗时、页面请求与可见响应；报告多次中位数及worst case，明确缓存状态。测试fixture快不能直接推断公网手机已更快。

## 最终审核记录格式

```text
Case: T05
Baseline source/release:
Candidate source/release:
Identity/data fixture:
Browser/viewport/theme/network/cache:
Steps and injected ordering:
Observed content + request/action/record identities:
Result: pass | partial | fail | not-run
Evidence files:
Remaining limitation:
```

如果有既有失败，应附baseline与candidate的同一错误和原因；新旧都失败只能称“已知未解决项”，不能把它记为功能一致性通过。源码保持不变可记“静态未变”，不能记“端到端通过”。无实体设备、听音或用户视觉确认的项目保留未验证。
