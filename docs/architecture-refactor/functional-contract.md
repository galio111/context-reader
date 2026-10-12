# 现网功能、界面与数据兼容契约

审计基线：生产 release `20261012T135500`，parent `20261010T223500`，source `4d0d91106087951d8d4271b46a328c0908f869d3`。这些身份由总负责人提供；本文作者独立读取该提交的工作树，不以共享目录里较旧的文档替代它。日期：2026-10-12。

用户本轮要求是保持原 UI、全部已有能力和体验，优化架构与性能后替换生产。本契约约束可观察结果，不能把“重写”解释成重做产品、删除边缘功能或重新设计界面。实现可以保留可靠模块并隔离职责；没有必要为了重写比例复制或替换全部代码。任何没有达到一致性证据的变更都不能借本文宣称已验收。

## 1. 证据与适用方式

- **S（源码证据）**：实际读过入口、类型、状态/事件处理、API 或对应核心模块；静态源码能证明实现路径存在，不能证明现网结果或视觉质量。
- **D（现态文档补充）**：当前产品/架构/专题文档补充跨文件规则。与实际源代码冲突时单独列出，不能静默选择会删除现有功能的一方。
- **R（运行证据）**：本独立文档审计没有登录现网执行写入、听音、完整浏览器截图或部署。本文件没有把历史报告的“已通过”当成本次 R 证据。
- [路由库存](route-inventory.json)逐项记录 78 个 API handler、12 个页面、方法、查询参数、字段引用、操作分支、限制/鉴权和响应行号；[阅读索引](route-index.md)便于查找。字段引用是静态索引，不是可替代类型和共享校验器的完整 OpenAPI schema。
- [测试库存](test-inventory.json)记录 108 个测试/SQL/fixture 文件和可提取测试标题；存在某项测试不代表它被执行，更不代表其标题中全部行为被动态覆盖。
- [源文件基线](source-baseline.json)记录 544 个 app/components/lib/types/tests 及配置/middleware/PWA 文件的 SHA-256；用它定位确切 UI/CSS/数据协议比较对象。[静态数据库存](static-data-inventory.json)记录217个仓库数据/媒体文件hash；[状态库存](state-inventory.json)提供存储key、事件、类型和RPC的源码行索引。两者均不是生产数据库导出。
- [验收矩阵](coverage-matrix.md)列出独立审核者应执行的可观察场景。每项默认“本轮未验证”，实现/测试 agent 必须另附真实结果、版本、视口、账号状态及证据；不能批量把库存项改成通过。

### 1.1 已发现的权威冲突

1. **首页词典可拖动/缩放**：基线 AGENTS 有“fixed dock，不可拖动”的陈旧描述；实际 `HomeRedesign.tsx:251` 的 `startDictionaryDrag`、header 指针事件及 `HomeRedesign.module.css:1072` 的 `resize: both` 保留了 >900px 桌面拖动/缩放。重构应保留实际行为；手机保持底部 sheet。坐标不跨会话持久化。不要用旧文档删此能力。
2. **公开预发布翻译/摘要与游客**：部分旧文本写“预发布缓存公开”；当前 `/api/translate-article/start` 明确登录门槛，`/api/summarize-article` 使用 `loginRequired: true`，首次交付预发布缓存也正常扣点；个人已取得结果重看免费。公开推荐元数据里的摘要可展示不等于付费摘要交付接口匿名开放。
3. **首页实现**：当前 `HomeClient` 使用 `HomeRedesign`；`BookHome`、`CurvedPageTurn`、旧 ArticleInput/ImmersiveHome 路径的源文件存在不代表它们是现网首屏。不得恢复翻页设计。
4. **密码/Anki**：新注册和改密为 8–72 字符强密码，旧六位 PIN 仅兼容登录。Anki 入口已退休，历史数据和兼容代码仍保存；“保留功能”不能被解释为重新暴露退休入口。
5. **商业入口**：计费规则、订单能力和邀请存在；`commercialUi.ts` 的两个 `NEXT_PUBLIC_*` 开关控制公开商业/用量细节展示，支付另受服务端配置控制。本文没有读取生产秘密环境，不能把源码能力写成支付已开放。
6. **历史数字/视觉验收**：专题文档中的题库数、价格、来源数和限额是基线/默认值；可配置项以生产配置为准。历史 release 的构建/浏览器通过不证明此次重构或实机已通过。

## 2. 全局界面和状态不变

**G01 页面结构**（S）：`/` 为真实 SSR 首页，`/home-v2` 永久重定向到 `/` 并保留查询；`/study` 跳到 `/?study=1` 打开同一个真实学习面板。`/guide`、`/account/usage`、`/account/repair-vocabulary`、`/pricing` 和 Admin 页面保留兼容入口。`?preview=guest|member` 只预览首页视觉，不能授予权限或改真实会话。

**G02 视觉基线**（S+D）：保留组件生成的层级、文案、字体、字号、间距、图像构图和高清度、透明层、布局断点、日夜主题、hover/focus/pressed/disabled/loading/error 状态。主要基线是 `app/globals.css`、对应 CSS Module、ReaderToolbar/ReaderTypography 与现有 React 树。架构拆分不得顺便换图标、卡片形状、阴影或改变控件位置。确认一致必须比较相同数据和状态的浏览器画面。

**G03 图片与动效**（S+D）：精选主推、普通和展开库存卡片均从 0.90 scale 入场，离开后重置，双向重入重播；首帧必须先绘制 reset 状态，逐卡延迟有上限。保留指针 3D 图层、分类切换、文章打开转场、返回原卡片相对位置。不能靠低清最终图、静止图、取消 hover/重入或不挂载展开库存来提高指标。图像本体必须运动，不能只保留 data 属性。

**G04 无障碍和输入**（S+D）：键盘可达、Escape/背景关闭/焦点返回按各现有弹层保持；输入框、textarea、contenteditable、翻译仍原生选择，不能全局 `user-select:none`。手机 coarse pointer 操作至少 44px，实际中心命中控件；拖动把手、透明背景、图片层不能覆盖可见按钮。减少动态效果与用户关闭动效后应显示可读稳定终态。

**G05 数据身份**（S）：guest、已在线核验账号、离线本地账号、停用账号、Admin、loopback 开发身份分离。`X-Context-Account` 是防错配声明而非授权。读取本地账号不能给 Admin、套餐或服务器写权限。跨账号异步结果不能进入新账号视图。

**G06 错误层级**（S+D）：区分无效/不支持输入、网络/离线、登录/停用/额度、站点配置/上游服务、浏览器持久化问题。普通界面使用中文可行动提示，保留重试、查看用量或错误编号；原始传输消息与密钥/SQL/私密正文留在服务端。取消不是故障，不发送故障告警。加载状态与成功/失败均不能靠永不结束 spinner 掩盖。

## 3. 首页、资源与 Menu

**H01 身份与返回**（S）：`HomeClient` 统管首页→Reader→Reader 内再开文章→返回；初始化账号和本地存储可并行。已登录访问先看到工作台，游客为品牌 Ballpit/落字开幕→录屏功能展示→精选/真题资源→自主导入→联系反馈。Reader 返回不重播初访 loader，演示视为已完成；保留资源 tab、分类、搜索、展开深度和卡片位置。账号登录不强行重置正在看的游客视觉旅程，但权限立即根据真实账号更新。

**H02 工作台**（S）：导入、独立查词、生词本、我的文章、学习入口和继续阅读保持。继续阅读优先最近的临时/公开/已保存阅读记录，而不是只从已保存文章选；标题、摘要、时间和进度与实际记录关联。账号学习摘要/提醒不阻断立即阅读。

**H03 游客品牌与展示**（S+D）：桌面 Ballpit、落字/字母场及原有开场保持；手机文字上层、少量球在后方，不跟随触摸。仅 hero 内明确向上纵向手势可吸附功能展示，横拖/短触/区外不触发。五个展示模块由点击/箭头/键盘切换，首尾循环、点当前重播，保留暂停；录屏静音 inline/循环，离屏/隐藏暂停，失败/自动播放受阻有可操作替代。缺素材的模块保持明确占位，不伪造已有录屏。

**H04 探索与说明**（S+D）：桌面说明吊牌有物理落下/拖拽/松手摆动后打开 Menu 内 guide，重复拖拽/切模块/离屏取消旧任务；非选中/隐藏/菜单打开暂停模拟。手机不挂载或预热隐藏 3D，直接打开说明。键盘/reduced-motion/WebGL 失败有静态可用入口。许可资源保留。

**H05 SSR 与目录**（S）：首页服务端返回轻量文章摘要和各分类初始窗口及总数，不能把全量正文/缓存打进首屏 HTML。首批十张可见封面 SSR preload，分类初始合集最多 50 篇。首批图就绪后预取 metadata-v2 全目录；显式展开/登录/源定位与预取共享在途请求。失败时保留已展示卡片，显式操作提供重试，静默预取失败不打扰。正文只在打开/真实意图预取时获取。

**H06 推荐排序**（S）：推荐池是 Admin 权威白名单，排除项不能靠全库存兜底回来。推荐主推无偏好时用后台默认；保存难度/兴趣后以白名单内最匹配项为主推。时事、科学、文化、商业分别分类；历史存储键 `科技` 显示 `科学`。上海当日选中项优先，判断来自 `selectedAtById` 而非编辑 `updatedAt`。分类主推不得让往日头条压住当日文章。

**H07 推荐浏览**（S）：初始一主推+三行三卡，前三行不混无图文章；text-only 仍在完整库存后段交错可读，来源标签和有意设计的文字版封面不能变破图。游客“登录查看更多”打开既有登录；会员“显示更多”逐批展开完整库存，搜索使用完整集合，按标题/来源/内容的现有语义。摘要仅标题 hover 或卡片键盘焦点出现。每日更新蓝标及独立上海日通知去重、可见时长保持。

**H08 偏好**（S）：外刊标题区游客/会员都可设置五级阅读难度和八类兴趣，多选、清空、保存后即时看到推荐排序变化；偏好不是新增内容分类。保留本地/账号同步与“已有偏好决定主推”规则。

**H09 资源切换**（S）：精选外刊与 CET 并列；首次访问默认外刊，Reader 返回恢复此前选择。未选资源标签更小更浅，原有资源标题/展示收缩上浮、反向滚动、焦点即显、reduced-motion 和输入桥保持。切换不消失自主导入/反馈后续文档流。

**H10 Menu**（S）：使用说明、生词本、我的文章、账号与用量、邀请码、反馈、设置及既有快捷入口保留。悬停预览、点击进入、详情/返回菜单、当前上下文关闭再打开保持；Menu 子页和独立路由共享真实内容，不创建假数据版本。设置包含日夜、字母动效、推荐动效。Admin 入口仅服务器核验有效管理员显示。

**H11 我的文章与生词预览**（S）：我的文章保持最近打开排序/摘要/日期、点击继续、右键/键盘菜单预填重命名和删除。生词本保持检索、触摸点按详情与滚动区分、复制、导出 CSV、单项删除/清空确认、来源跳转、学习入口；手机不依赖 hover。菜单和详情的测量虚拟化不能用固定超高空白行替代。

**H12 独立词典窗口**（S）：桌面当前实际可拖动且 `resize:both`，有最小/最大边界、关闭退场，不能拖到完全不可达；手机底部 48dvh 起始、25–82dvh、内部独立滚动、关闭按钮；每次重新打开恢复 sheet 初始高度。首页和 Reader 的词典功能完整一致，桌面/手机样式不能相互污染。

主要来源：`app/page.tsx`、`components/HomeClient.tsx`、`HomeRedesign.tsx`、`HomeOptionMenu.tsx`、`FeatureShowcase.tsx`、`ShowcaseRecording.tsx`、`ArticleCover.tsx`、`useArticleReveal.ts`、`usePublicationMountCount.ts`、`useDailyPublicationNotice.ts`、`lib/homepageBootstrap.ts`、`homepageRecommendations.ts`、`recommendationPreferencesShared.ts`、`coverMediaQueue.ts`、`publicReadCache.ts`。

## 4. 导入、文章结构与 Reader

**R01 粘贴导入**（S）：输入英文正文、清空、开始阅读，空白输入给明确错误。游客成功导入消耗自己的 pasted-text pool；会员导入免费。首页和 Reader 内导入工作层都打开真实 Reader。尚未保存的临时粘贴/URL 内容在返回首页、浏览器返回等离开路径遵循现有确认，不可悄悄丢失。

**R02 URL 导入**（S）：校验 http(s)、公共可达地址，限定 HTML/超时/重定向/字节数，安全抓取后共享正文清理器抽取标题、来源、作者、原发布日期、语言与 blocks。成功直接读正文，不插入只读预览。普通图片在短预算内本地化；慢图片可后台处理，明确提示并预留比例，正文不阻塞。失败保留输入、分类提示和“改为粘贴”入口。

**R03 内容完整性**（S）：blocks 支持 heading/subheading/paragraph/list-item/quote/caption/table/image；保留 sup/sub、列表 ordered/unordered/层级/起号、表格 header/scope/rowSpan/colSpan。表格窄屏局部横滚，不让整页溢出；每格可查词。HTML 命名/十进制/十六进制/多层转义实体还原；去重复标题前缀、相邻重复段落、精确重复图注，不能吞掉独立图注/正文。链接中的真实 editorial figure 不当推荐卡剔除；可信 metadata hero 可补正文，缩略图不冒充高清 hero。

**R04 图片**（S）：保持自然比例、图注查词、来源与打开查看器；下载经安全接口。查看器按光标点缩放、拖移/重置，像素锚点不能因光标改变漂移。既存 OCR layoutWords 可兼容显示；新 OCR 入口与自动识别仍关闭。图片失败是安静的来源标记 fallback，不能破图；不以换图/强制低清达成性能。

**R05 正文与查词 token**（S）：英文词/带重音 Latin/撇号/连字符按实际分词支持；token id 跨 block 唯一。文本仍可读、原换行/sup/sub/图注/list marker 不丢。远处 block 只挂普通文本，靠近视口才挂交互 token，远离再卸载；连续滚动推迟 hydration 抖动。不能为来源定位一次性保留所有 token 或唤醒前方图片。

**R06 选择行为**（S）：桌面单词点击/跨 token 拖短语；选择生成 word、完整句、前句、后句。手机普通纵滚不查词，明确横向选择/长按才短语；pointer cancel 清状态。token 下划选区和其他文本选择不串到另一段/旧文章。工具面板选择关闭及时取消当前查词，切新词丢弃旧请求回包。

**R07 解释工具**（S）：工具状态包括未选中、加载、流式字段、结构化完成、缓存回放、错误/额度、加入生词、复制、重新生成和 AI 追问。流式所见字段为权威，不能完成后突然换成另一套模型内容；缺当前词 IPA 的单词不能宣告完整成功。所选词/短语、原型归属、词性、基础义、语境义、原句翻译、用法、搭配、英中例句、难度保持，长句必须完整同步。

**R08 追问**（S）：桌面/手机、流式完成/缓存解释都可继续提问；请求带所选表达和完整句/前后句，显示独立加载/答案/失败；新选择清旧问题。手机输入字号/触控目标、软键盘回车换行与桌面 Enter 提交差异保持。无上下文/空问题不得发送。

**R09 阅读状态**（S）：开公开文章立即写最近阅读；若已保存或后来保存，归属同一保存文章。进度由 block identity/text、index、top、scrollY/ratio/capturedAt 保留。快速扫到下方立即退出按现有快速滚动策略下次从顶部，稳定停留后保存准确位置；来源跳转必须精确且不被该策略重置。可见“返回首页”清 Reader 会话栈直达根，浏览器/系统后退只回上一篇。

**R10 来源定位**（S）：从生词/学习进入当前文章、已保存文章或 durable public article id 找原句与所选词，优先身份、缓存索引，再可让出的模糊回退。找不到时明确不能定位，不能自动新造另一篇。跳转后高亮、滚动、最近阅读/锚点持久化；图片后续布局也保护对齐；不重渲染整篇长 token 树。学习来源跳转保留原卡挂载，有浮动返回学习入口。

**R11 编辑**（S）：原位 contenteditable，读/编辑同字体/布局，Enter 保留显式空段；不换成 textarea，不每键 controlled 重建 DOM。图片 read-only block 可整块删；表格/文本保持各自结构。编辑/取消/保存前后精确 scroll pixel、正文唯一、不重复渲染。保存用户文章回本地+同步，Admin candidate/published 正文保存回原行。

**R12 Undo/Redo**（S）：会话内独立历史包括正文/块变化，保存不清空历史，返回首页结束会话；快捷键与可见控件同步，不能借 browser execCommand 替代。取消编辑恢复已保存快照，连续编辑/保存/undo/redo 不错对象或丢空段。

**R13 保存与摘要**（S）：登录限制在保存动作，文章先立即安全保存；仅无有效摘要时请求 first-save 中文简要摘要；已保存显示禁用“已保存”，无摘要再生按钮。超过 50,000 字符/摘要额度不足/模型失败文章仍保存。预发布摘要按当前正文身份命中并收费，已有个人摘要不重复生成。重命名不重置正文/来源/进度。

**R14 阅读设置/工具**（S）：保留字体 system/serif/mono，字号 small/default/large/xlarge、行距/段距、内容宽度、图片宽度和日夜；Reader 侧栏/更多、导入、词典、词汇、文章、翻译、Menu 都保持上下文。Admin Reader 的“返回后台”及文章设置入口保持，不变成普通首页返回。

**R15 手机工具滚动**（S）：`useMobileBottomSheet` 为单一高度/手势权威：Menu 56dvh、Reader/词典48dvh，上限82、下限可停25；低于25才按距离关，最近28px/0.62px·ms⁻¹ 快甩关，停80ms不能沿用旧速度，取消还原起高。sheet 内 wheel/touch（含空列表/上下边缘）不得串正文；sheet 上方裸露正文仍可滚，不能锁整页。resize/reopen/横竖屏/软键盘不能留旧锁或遮按钮。

主要来源：`ReaderView.tsx`、`ReaderTextAdapter.tsx`、`ExplanationPanel.tsx`、`WordToken.tsx`、`useMobileBottomSheet.ts`、`useMobileSheetScrollBoundary.ts`、`lib/tokenizer.ts`、`readerBlockInteractivity.ts`、`readerTokenIdentity.ts`、`sourceMatching.ts`、`readingProgressPolicy.ts`、`urlArticleExtractor.ts`、`articleContentSanitizer.ts`、`importedArticleNormalization.ts`、`articleMedia.ts`、`imageZoom.ts`。

## 5. 流式请求、词典、发音与缓存

**L01 一次动作**（S）：语境与词典 stream-first；结构化 fallback 只在需要恢复时走，不能并发两次模型竞争。`x-context-action-id` 等幂等 identity 贯穿 stream/修复/重试；quota refusal 不进入 fallback。默认 lookup/dictionary 是 `deepseek-flash`，故障独立 Zhipu fallback，不恢复 Flash/Pro 轮换。真实每次 provider execution 单独记录，用户只收费一次。

**L02 取消和失败**（S）：关闭、换词、AbortController 与 `/api/lookup-cancel` 可以覆盖“先关后注册”竞态；取消及时退款，不上报供应商故障或邮件；已完整成功与畸形/半截内容区分。短暂不可达/429按策略退避；非重试型输入/账号拒绝直接显示，不无限回环。流式 chunk 任意切分、末段无换行仍正确，不能丢尾字符。

**L03 词典输入**（S）：独立英汉/汉英；英文一个词或最多八词短语，中文短词/短语，实际校验由 `sanitizeDictionaryQuery/isValidStandaloneDictionaryQuery` 决定。无效内容在模型前拒绝。支持正常、词形变化、同形歧义、拼写错误四种状态；拼错显示建议，不能编造义项；点击建议是新的明确查询。

**L04 词典输出**（S）：英文当前 query、lemma、当前拼写 IPA+归属、英美读音组、义项/词头/词头关系/词性/语域/用法/双语例句、动词三态、核心用法、搭配、词族、近义辨析、常错和记忆提示都保留；按实际字段存在显示。`fell` 保留 fall 过去式和独立 fell；不能一律合成 lemma 释义。汉英以中文为词头，按词性相邻排列自然英文候选及各自 IPA/语境/例句，不强塞不适用板块。流式、完成、回放布局内容一致。

**L05 词典历史**（S）：历史索引与完整结果分别持久化，每次点击只读取对应完整结果（local per-item snapshot 或登录专用 GET 恢复），不会自动再生、扣费或重建整本历史。缺结果给可理解缺失/手动新查询选择。至少用1200条规模确认不会载全量结果再定位一条。删除历史产生因果 delete event/tombstone，旧tab/cloud/缓存不能复活；删除后用户新查只有观察到删除的 query intent 才重入。账号切换中的晚结果不能写新账号。

**L06 发音**（S+D）：UK/US、词/短语 click-to-play，自动预热不自动播放；实际不同 IPA 才拆 POS/义项行，像 bass 的不同义项同词性异读保留，IPA相同不人为增行。缓存/请求身份含文本、口音、实际 IPA/SSML版本必要维度，不能串音；优先复用同录音，在途共享，播放器就绪/快速多点/换词 race 不丢首次点击。既有批准音色和语速保持。200 MP3 只证明可取，词/重音/音素正确须 raw provider 音频+可信参照与听音；本文未听音。

**L07 缓存与学习动作**（S）：语境 key 包含词及上下文；流字段并入 durable explanation。缓存命中不收费，`/api/usage/cache-lookup` 当前为 read-no-charge 兼容返回。独立词典保存转成完整 VocabularyEntry，并判定已保存；复制含 IPA归属与所有对应学习字段。重新生成已有词保持 entry id/createdAt/Anki receipt/站内 study identity。

主要来源：`BookDictionary.tsx`、`PronunciationButtons.tsx`、`lib/contextExplanationClient.ts`、`explanationStreamProtocol.ts`、`explanationStreamStore.ts`、`explanationSyncIdentity.ts`、`deepseekDictionary.ts`、`dictionaryStream*.ts`、`dictionaryResultSnapshot.ts`、`standaloneDictionaryHistory.ts`、`dictionaryPronunciation.ts`、`pronunciationClient.ts`、`pronunciationSsml.ts`、`providerFailover.ts`、`activeLookupRequests.ts`、核心 API。

## 6. 全文翻译

**T01 触发与生命周期**（S）：打开/切到翻译工具不启动，用户点击启动；离开该工具不自动取消后台任务，返回显示同任务/已完成进度。任务绑定文章正文版本，不把另一篇或编辑前结果套过来。已有结果可读；force regenerate 不清旧成功结果。

**T02 启动校验/计费**（S）：`/start` 收真实唯一 id/type/text blocks、cacheKey、actionId及上下文身份，不能仅发送 blockCount/characters。生成块不超过2000、单text不超过32000、id不超过160，body受512KiB界限。private/public-cache 都要求有效登录；public-cache 验当前完整正文缓存，按 user+public id+version 稳定 action 幂等；生成 task 绑定该版本。

**T03 批处理和输出**（S）：浏览器可按最多10段/约5000字符组批，完整文章 contextBlocks 随每批提供；上游一次上下文、输出仍逐块展现。provider JSON 完整对象边界解析跨 chunk，不依赖物理换行；接受 `{id,translation}` 或仅精确对应 requested block type 的值，不能任意 key 当译文。前端 NDJSON translation/error事件保持；只接受有效非空对应 id，顺序回填不乱。

**T04 续传/重试**（S）：完成块即 durable cache，未变块复用；部分失败只重试缺块，最多8次的有界重试/退避到30s、连续零进度3次转人工重试，显示剩余等待与原因，不能永久自动循环。中途失联重开保留真实已完成块；零完成不能说已保留进度。

**T05 编辑后缓存**（S）：精确正文/块 identity区分过期、删除、保留；显示需更新的段和失效提示，保留原译文直到新成功；仅未改块可免费复用。结算以服务器验证完成块/词数，reserve/finish/refund幂等；不能信浏览器传“全成功”获得免费完整结果。

**T06 CET 和公共缓存**（S）：CET 翻译当前篇正文+题干+选项+词库，历史读取提交快照文本；保存文章仍只正文。Admin published 只有直接“上传全文翻译”，表示无缓存/已上传/成功，要求当前完整缓存；candidate不展示翻译入口/粘贴/映射/预览确认。发布可自动复用完整当前正文缓存。

来源：`ArticleTranslationPanel.tsx`、`ReaderView.tsx`、`lib/articleTranslationJobs.ts`、`articleTranslationBlocks.ts`、`articleTranslationIdentity.ts`、`articleTranslationBatching.ts`、`incrementalJsonObjects.ts`、`translationBilling.ts`、`app/api/translate-article/*`、`lib/cetTranslationBlocks.ts`。

## 7. 生词本、原生学习和阅读画像

**V01 生词数据**（S）：VocabularyEntry保留当前词、lemma/IPA归属、全部解释字段、sourceSentence/前后句、durable public source、difficulty/shouldAdd、id/创建更新时间、Anki card/receipt。按规范词+原句去重；同词不同语境可存在。重新生成合并完整字段而不重置身份/调度。导出CSV、复制、删除/清空确认和来源跳转均保留；没有恢复已退休 Anki操作按钮。

**V02 学习入口与卡片**（S）：工作台/Menu/生词本、`/?study=1`共用StudyHost/Panel；已登录面板预取保留，暖返回同卡，cold load有诚实加载；左右/底部导航有today、词库、stats、rewards、settings及profile入口。中文提示默认折叠；词头旁原文链接、撤回、new/review标记与原切词动效保留。其他工具/来源阅读不计学习时长。

**V03 服务器调度**（S）：FSRS-6 ts-fsrs5.4.2，服务器计算 stability/difficulty/due，版本+账号+present token验证。默认目标保留90%、可85/90/95，fuzz关闭；Again短期5分钟、New/Learning/Relearning Hard10分钟，可1–120；长期 Review按库计算，不把所有Hard变10分钟。浏览器不能自报未来到期时间。

**V04 学习顺序**（S）：先当天安排到期复习和短期巩固，再新词；默认100复习/日，可1–300；新词无50上限（日奖励另有限额）。上海日计划固定，当天新保存词可补新词，复习目标不扩张；达到计划上限后的剩余积压留以后。复习上限/retention对下一新计划生效，短步骤保存后生效。

**V05 答题和幂等**（S）：先独立回忆“不记得/模糊/记得”，核对后 forgot/unsure_wrong→Again，unsure_right→Hard，remembered→Good；不新增隐性Easy；查看原文为提示该次Again。在线保存成功才前进；失败保留待确认答案/id重试，最短答题保护850ms一次自动重试用原id；两设备冲突用服务器状态而非覆盖。15分钟内、未再次作答、未成为奖励依据可撤销；保留撤销事件，已奖励依据不可撤回。

**V06 时间、暂停和设置**（S）：学习仅计前台有焦点展示到可信操作的有限片段，30秒段、每题最多1分钟；后台/工具/空置不计。暂停1/3/7/14/30天先确认，暂停停新计划/提醒并立即断streak，不改真实memory/due或历史奖励；恢复分批消积压。设置约450ms后自动保存、离开flush，失败保留pending并可重试；词序/动效开关和复用CetSelect的自定义下拉保持。UI数字在blur时按现有规则规范化到范围，服务端独立校验；不得误把复用CET样式写成新增“CET学习列表”能力。

**V07 词库与统计**（S+D）：词库可检索/状态过滤，英中列遮挡、单格揭示；未学/巩固/较稳固只算站内参与词，待迁移Anki隔离。较稳固是Review+stability≥21天+当前recall≥90%，不是永久熟练。真实30/90/365词数与时间趋势分新/复习、7天预测、52周学习日历。原Anki迁移历史保留原评分/来源/时间，不把迁移计新奖励；不删965词等用户历史。

**V08 点数奖励**（S）：完成当天安排复习后，首次学完（今日回答且进入长期Review，下次到期越过当日结束）每新词1点，默认日最多50；其他未完成新词不阻止已获奖励。达成/待领取/实际领取分离，claim事务幂等、并发不重复，继续学习领取新增差额。同规范表达不因删除重建或方向改变重复奖励；默认90天有效，配置由Admin可改，既得快照不回收。

**V09 连续奖励/会员**（S+D）：当天复习完成+至少5个此前未奖励新词才streak，缺一天/暂停中断。默认2/3/7/21天分别50/100/500/1000点，30天Basic1月、60天Plus2月、180天Plus6月、365天Max12月，每档每账号一次。奖励可稍后领取，会员是永久待启用权益；同档延长保留月额度anchor，不同档/Admin不被覆盖，年期按月发点。设置变化不重写历史奖励。

**V10 阅读证据/画像**（S）：真实Reader前台可信操作间≤45秒可计、每15秒上报、请求≤30秒、每日≤4小时、跨tab不叠加；鼠标移动/后台/失焦/工具/空置尾不计。图片/长段静读后再动作可计有限段。至少60分钟verified evidence+50不同阅读查词才主动生成，默认5点、明确确认；重看免费，失败退款，同action重试幂等。不能把旧active_seconds等同verified，不以未查词推知认识，输出难度/有限证据/建议不伪造精确词汇量或考试分。用户可主动应用到推荐偏好。

来源：`VocabularyPanel.tsx`、`VocabularyLearningDetails.tsx`、`StudyHost.tsx`、`StudyPanel.tsx`、`StudyWord.tsx`、`StudyVocabulary.tsx`、`StudySettings.tsx`、`StudyStats.tsx`、`StudyRewards.tsx`、`StudyDialog.tsx`、`useStudyTimer.ts`、`useReadingEvidence.ts`、`lib/study*.ts`、`types/study.ts`、`docs/study-*-migration.sql`、`/api/study*`。

## 8. CET 题库、练习、自测、听力、历史

**C01 目录与授权**（S）：只有CET4/6，按卷/题型和年份/分页（12一页）；游客每级可访问12条，预览 metadata不能含正文/答案，detail API也限制实际可访问集合。快速筛选取消旧请求，非法页/年安全回退；目录placeholder、加载失败重试、窄容器单列/宽容器双列保持。不得因为静态目录包含全部题而绕过detail授权。

**C02 题库不变**（S+D）：现有题干/选项/答案/解析/段落/词库/材料id/题组id/来源PDF/answerSource/sha256要保持；正常题型cloze、matching、detail、listening。专题基线149卷（73/76）、596阅读部分/4470题；62卷含听力、1550题/465组/61录音是文档库存数，变更时需对 `data/cet` 独立计数和hash确认。写作与翻译试题尚未接入，不在本轮冒称现有功能。

**C03 进入与活动身份**（S）：选择阅读练习/自测后显式开始才建activity；取消不生成空记录，自测每次新ID不复制旧答案。paper/section scope、owner、purpose分离；最近记录可继续/查看结果，重做新record，旧答卷不修改。真实Reader共用阅读工具，题目窗/段落渲染与源定位均保持。

**C04 练习作答**（S）：选择/改选/清空只改草稿，cloze在正文空格下拉作答且不显示题窗；其他题型按现有题窗作答。按篇提交、当前范围一次提交所有未提交篇；未答先确认可取消，本地持久化成功后才揭解析，已提交篇冻结而下一篇仍可答。整卷显示完成篇数与唯一活动记录。

**C05 自测边界**（S）：开始固定scope/计时模式/预算；进行中禁查词、翻译、保存、生词、提前答案/外链。暂停当前代码保留正文/已选答案/划记/题目窗可读，但不可继续作答；继续保持位置再作答。提交/结束精读恢复阅读辅助，未完成结束保留ended快照不伪成完成。

**C06 计时**（S+D）：练习只计可见未提交篇，后台/工具不覆盖用户手动暂停，复盘已提交篇不增加原用时。自测countup/countdown，默认纯阅读卷40分钟/单篇10分钟，含听力按实际音频长度加阅读/缓冲预算，1–180有效；显式调整/归零保留累计用时/epoch，不篡改旧连续计时条件。隐藏/刷新/浏览器后退继续预算，应用内保存离开明确暂停并永久标中断。练习到零只暂停、不自动提交；自测到零由CetReader提交time_expired并固定答卷，旧版手动计时不可强升新版。

**C07 划记**（S）：自测进行中/暂停可在原文/题干/选项/词库选词句，选区边显示下划线与蓝/绿/橙/粉，点已划线可改色/删；空格作答控件排除，句尾/跨标点/触摸/键盘边界保持。草稿立即存，提交固定underlines与对应当时文本；结果索引能跳原文/题目，历史只读且无旧划记不补造。划记不算答案/分数。

**C08 题型路线**（S）：底部位置/可访问总题组，上一题沿已浏览序列倒退、下一题先恢复前进，末尾才随机追加未看，全部看完从首条顺序复看；owner/level/type/purpose独立持久化。年份直达也追加。浏览顺序不是答卷scope；不能把累计看过数当当前位置或静默扩大自测范围。

**C09 答卷与同步**（S）：v2/v3/v4活动兼容、legacy v1 attempt原样保留；immutable finalization 包含当时questions/answers/content+answerVersion、可靠题数/未答/用时/条件、听力/划记快照。跨设备按事件时间/id与timer revision融合，不用“最后打开整个对象覆盖”；owner隔离、不认无主旧cache。旧历史不能因新题修订重算成另一份试卷。

**C10 历史和统计**（S）：全局历史默认跨全部真题，级别/目的/提交状态过滤、每次30条加载及正确率/用时等只从真实可计分记录派生；已提交显示“已提交”可回看，重做不篡改其他记录。宽窄布局及手机固定close/Escape/背景关闭保留。没有可靠参考答案的题不能被当成普通错题制造分数；不凭存储内部存在删除方法创造未在UI出现的历史删除入口。

**C11 翻译/保存/题窗**（S）：当前题篇的全文翻译含正文+题干+选项+bank，题干/选项选区查词沿原上下文；保存文章只有当前正文。右侧题窗复用同一答案/提交命令，不能双状态；自测暂停保持窗口但作答禁用。控件不能盖住计时/返回，cloze没有隐藏残留题窗。

**C12 听力**（S）：播放器显式点击后才load；练习可播放/暂停/拖进度/结束后重播，显示当前/总时长，当前组件没有倍速或音量专用UI。自测连续播放，隐藏暂停/seek/速度控件，播放中和结束后禁重复play；系统中断允许从保存位置恢复并记条件。每15秒和离开checkpoint按activity/section存，blocked/stopped立即停；buffering/failed明确可重试。录音与原文组配对、只有所有组内题目揭晓才显示对应transcript；source有核实时间边界才具备分段重播条件，不凭原文段落猜时间。没有录音明确缺失，不伪装可播放。不可换录音/语速作为性能优化。

**C13 Admin题面修订**（S）：`getAdminAccessMode()==="developer"` 的真实开发者账号才可使用题面编辑；恢复password-admin也不行。文本paragraph原位修订、expectedRevision冲突/错误保持；正常用户无该权。仅持久override，不重写原公开来源hash或历史答卷；填空编号不能变，正文大幅改动被拒。

来源：`components/cet/*`、`types/cet.ts`、`lib/cet*.ts`、`app/api/cet/*`、`app/api/admin/cet-paper/route.ts`、`data/cet`。本文件没有逐字人工核对所有题目/录音，重构原则为数据文件保持hash不变。

## 9. 账号、额度、持久化和同步

**A01 注册/登录/改密**（S）：大陆手机号identifier+昵称+密码、无短信、phoneVerified=false。新密码8–72非空白可打印ASCII、至少字母数字；旧六位数字PIN可登录直到自愿改。内置synthetic email不显示/不外泄于导出。HttpOnly/SameSite cookie，生产Secure，400天rolling上限受后端会话/主动退出/停用/改密约束。没有未验证身份的自助找回密码；保留明确说明。OTP/adopt-session为隐藏兼容能力，不恢复主登录。

**A02 登录与离线**（S）：认证成功在本地存储准备好后发布 verified account/关登录框，云恢复后台进行，不阻塞所有UI。session check失败进入“离线身份”而非游客/登出，只可重看本账号本机资料和缓存；新服务请求提示重连。重新上线恢复验证后再授权；local-only仅loopback，不可线上模拟免费Admin。

**A03 档位/邀请**（S）：guest/free/basic/plus/max/admin及active/suspended/deleted语义保持。邀请码随机唯一，单次明文展示后只hash+hint；admin选Basic/Plus/Max、兑换日起天数（1–3650）、可另截止、私密备注，可停用未兑换。已登录原子兑换，active非Free/旧邀请不叠加替换，到期回Free后可再领；同码并发只有一个成功。

**A04 点数和游客池**（S+D）：游客上海日4独立池默认10语境/5词典/2文本/2URL；cache/fail/timely-cancel不消耗。登录非Admin为learning_points：语境1、词典5、追问5、摘要2、翻译按500英文词向上取整每组10、画像默认5；学习复习/普通阅读/导入/单纯保存免费。Free默认300/月，其他档额度/价格可配置，不能在前端硬编码替换服务端真实值。

**A05 额度UI与动作**（S）：guest超池提示登录，会员保持自己pool身份显示used/allowed/reset上海时间与查看用量，不误说guest exhausted；0额度不承诺到重置就可用。少于5%提醒一次/账号/窗口/阈值，约3秒，不能每渲染反复。用尽不阻止原文/cache，不能退出或清文章。详情/商业marketing的开关分离。

**A06 账本**（S）：action幂等reserve/finish/refund、真实provider execution/token/model/cost分账。重试、stream修复、provider fallback最多一用户成功charge；缓存公共功能首次交付仍收费但provider成本为零。translation partial服务器验证完成块结算，未完成退还。修改共享 `consume_usage` 只能经恢复备份隔离DB验证每configured metric及重复action；不得凭新增功能一条成功就替换全站账本。

**A07 浏览器持久化**（S）：`learningStorage` 为同步内存adapter+异步IndexedDB事务（`context-reader-learning-v1`），不篡改原生Storage API。article/vocabulary/cache/translation/reading/preferences/manifest逐对象保存；旧localStorage/plain与lz-utf16格式兼容。先备份、提交、验证，再仅删未改变的本应用legacy key；晚旧tab写先备份/保守合并，不clear整个localStorage。

**A08 容量/失败**（S）：IDB失败保留pending、明确local-save warning和retry/export；账号切换先归档未上传owner数据。仅已确认同步的 explanation cache可按recency超20000/40MiB淘汰，未送达cache/文章/生词不得淘汰；migration/recovery备份不借此次优化清除。

**A09 Protocol2**（S）：初次snapshot固定server view，activepayload+tombstone元数据，先learning(文章/生词/reading)后cache；中断阶段在IDB checkpoint并30分钟内resume。增量opaque `(updated_at,kind,object_key)` cursor、version/hash manifest，上传≤200对象或约1.5MiB，ack durable；不能每15秒全量下载或把缺本地项当删除。legacy offset/group参数仍兼容。

**A10 合并**（S）：cloud authoritative但补入本地不丢；CAS expectedVersion冲突refetch最多3次。article同身份合并为一个canonical并tombstone旧ID；vocabulary规范word+sentence合并最完整解释/Ankireceipt；真正同ID歧义留独立recovery，不在正常列表造“恢复副本”。reading/cache/preferences/CET/dictionary事件按各自merge语义保持。

**A11 同步与退出**（S）：本地durable变更约800ms上传，可见已登录约15秒拉取，focus/visibility即拉；普通后台同步/恢复/限流重试静默，只手动sync在账号页显示进度结果，严重本地写失败独立警告。401刷新身份不清学习数据。退出先成功同步，失败阻止退出；成功仅退出本cookie会话，别的独立设备保持登录，并清/切换本账号活跃缓存而保留recoverable数据。

**A12 账号资料/导出/修复**（S）：账号页可改昵称/密码且手机号不可在此修改；profile API另接受englishLevel、readingInterests、birthYear、gender，逐项验证，保留旧profile中其他兼容字段，不凭类型存在就新增可编辑控件。导出包含account、全部同步objects（文章/生词/缓存/进度/CET等）、usageActions、study settings/cards/reviews/days/rewards/claims/streaks/evidence/profiles，不泄synthetic email。studyRows有显式上界并在超限报错；当前usageActions请求本身有最近10000条limit，不能把导出宣传成无上界完整用量账本。`/account/repair-vocabulary` 显式修复只处理已授权目标，不能扫描时顺手删词。

**A13 商业兼容**（S）：现存计划/月年报价、membership/topup、order check/create、WeChat signed notify、Admin退款/异常review能力保留但不因重构打开支付。一次月/折扣年不自动续费；订单price/points/basis不可变snapshot，同年plan topup/升级credit/按月grant以billingPolicy为准。待配置返回“尚未开放、不会扣款”，不能模拟成功。

来源：`AccountProvider.tsx`、`AccountUsagePageContent.tsx`、`InvitationCodeRedeemContent.tsx`、`BillingPage.tsx`、`lib/userAuth.ts`、`sessionPolicy.ts`、`passwordPolicy.ts`、`usageIdentity.ts`、`usageGate.ts`、`accountStore.ts`、`billing*.ts`、`learningStorage.ts`、`accountSyncClient.ts`、`accountSyncCursor.ts`、`savedArticleMerge.ts`、`vocabularyMerge.ts`、`localAccountSession.ts`、`/api/account/*`、`/api/auth/*`。

## 10. Admin、发布、发现与自动精选

**D01 授权与导航**（S）：Admin layout/session每server请求校验有效active admin；普通account/guest不因local标志打开。遗留password-admin仅recovery，独立logout；读取/变更都server check，同源mutation、限body和私密no-store保持。后台候选/已发布/账号用量/来源/模型/反馈/错误等现有tab与子导航不合并丢项。

**D02 候选入口**（S）：已保存文章、粘贴、URL、手动/订阅发现统一candidate。URL复用同一safe fetch+sanitizer；普通/单source手动crawl只候选，不自动publish。候选含标题/摘要/来源/原发布日期/难度/主题/封面及body版本；真实Reader改body，metadata留Admin。切下一候选释放上一篇saving/loading状态，不能“精选并继续”永锁。

**D03 审核和发布**（S）：人工reviewed cover必需；远程cover经pinned DNS下载、限字节、decode验证、content-addressed WebP入当前public-article-covers bucket。自动模式还需full-text/images完整性、v3审核、正文hash/版本、有效时限/多样性等；crawler output成功不自动成为published。candidate publish/update/delete保持原row身份与expectedUpdatedAt冲突保护。

**D04 首页编排**（S）：published开关立即persist，失败可见回滚，无独立“保存首页位置”；candidate开关draft到发布。category featured/recommendation pool/recommendation featured分别控制且featured单例；取消pool清该项recommendation featured。推荐白名单最多500的边界、分类orderedIds最多10000保持；分类变化/移除不能产生另一个隐藏入口。

**D05 媒体与翻译**（S）：cover/body四态 `cover-and-body`/`cover-only`/`body-as-cover`/`text-only`保留，排除synthetic `public-cover-`判断独立body图；真正text-only不乱补图，有已审核cover且清理误删唯一body图才同图幂等backfill。日期使用source publishedTime，不把createdAt当发表。published直接上传当前完整译文，candidate无翻译UI。

**D06 来源管理/手动抓取**（S）：来源启用/停用、rights/cadence验证、RSS配置/目标和当前run/历史结果保持。robots、去重、抓取预算/lease、源站提取profile和安全图片约束适用；文章太短/仅页脚/付费墙/污染需明确原因，不用200当正文成功。手动与定时action隔离、不能并发重复处理同source。

**D07 自动精选日流程**（S+D）：enabled validated sources每小时分批存RSS候选链接，06:00开始付费审；时事/科学/文化/商业每日各至少14为数量floor而非上限，达标继续到硬预算。240attempt/120分钟/共享¥1.50默认硬界保留，临时budgetTrial按明确日期配置；不能把一次显式backlog补审算成每日固定支出。401英文词、真实已存body图、正文hash、48h审核及新闻7日时效仍必需。来源覆盖不足要诚实报告。

**D08 持久队列**（S）：链接分类pending、technical-retry/inspection、content-rejection、policy-skip、published/dedup分别持久；未知短抽取不是低质量拒绝。网络/图片/model-format技术失败1h/6h有界retry后人工，RSS掉出不丢未处理；每source5000容量报警不静默淘汰unresolved。人工重试入口不跳过出版门槛。综合review包括有界完整正文+最多24图，不能采样丢素材来批准。

**D09 日恢复/收尾排序/邮件**（S）：day ledger/lease/paid reservations可恢复重入，正常scheduled、同日bounded recovery和用户授权backlog统计分开。收尾对所有published历史五组排序今日在前、当日featured保留，CAS排序receipt与排序同写，重复wakeup不重排；补新文章后再完成收尾；不扩大recommendation whitelist，不产生model charge。邮件sent仅SMTP接收，实际收件未由本文验证；持久日账不依赖邮件成功。

**D10 模型配置/健康/费用**（S）：按功能/plan主备配置、支持provider+model目录、probe/status、routing guard、budget/usage报表保持；主备独立，HTTP200空content/缺token usage仍provider失败且未知费用预留。显示实际调用/成功/失败/tokens/estimated cost与用户action分离，上海日/区间/source/model/account过滤；config和密钥不可放前端。报表截断需明确而非“总数”。

**D11 账号/邀请/奖励配置**（S）：账户列表状态/plan/bonus/quota/month-day/window、reset usage、临时重置密码兼容action、price/points、study policy和streak档位、invitation创建/停用均保留AuditLog；停用立即服务器拒绝，不只隐藏UI。产品统计DAU/WAU/30日MAU取真实presence行，不以页面浏览量冒充独立用户。

**D12 反馈/故障/修复工具**（S）：反馈列表详情/status/delete及私密附件读取/删除，错误列表筛选/细节/status/delete和持久trace，图片repair页面/saved image修复，experience preview/frame工具保留。修复是显式受权动作，不因首页加载运行；后台详细技术故障仅Admin可见，network/input不当developer panic邮件。

来源：`app/admin/*`、`Admin*Panel.tsx`、`lib/publicArticles.ts`、`publicArticleInput.ts`、`publicArticleCovers.ts`、`homepageCuration.ts`、`discovery*.ts`、`recommendationCrawler.ts`、`editorial*.ts`、`model*.ts`、`adminUsageReport.ts`、`errorReportStore.ts`、`feedbackStore.ts`、`/api/admin/*`、`/api/cron/recommendations`。

## 11. 反馈、PWA、安全和运维边界

**O01 用户反馈/联系**（S）：首页/Menu反馈类别、正文、可选contact、清空、附件preview/remove/submit/status保持；最多3图、每图5MiB、请求16MiB，格式/真实decode检查。私密bucket不public list，管理员删除连附件；honeypot/限流/同源保持。联系入口复制微信/二维码、复制失败提示，“填写后可回信”独立可读；不新增自动向他人发信。

**O02 PWA**（S）：manifest/icon/offline、生产service-worker注册/前台更新和旧cache版本清理；开发仅移除本应用worker/cache，不动账号数据。静态hashed JS/CSS cache-first有界，公开文章detail network-first≤7天/50条，metadata-v2单version key短缓存/ETag304；navigation失败回root/offline。缓存写失败不能用旧页面覆盖已拿到fresh response；cookie账户/同步/quota不交给public SW缓存。

**O03 静态资源与图片**（S）：Brotli/gzip协商、ETag/Vary、public静态路径约束和不可遍历；有界cover preload网络并发、decode/readiness缓存、隐藏暂停保持。warmup不能抢显式阅读请求，observer/资源取消cleanup不能泄漏或保留全部高清decoded image。原文件/原构图必须仍可达到；冷图真实paint不能用HTTP200代替。

**O04 安全网络**（S+D）：remote fetch必须pinned DNS、private network/IP/redirect限制、字节/timeout/content-type/robots，海外仅认证bounded公共文本relay，不能传cookie、private article、Auth/Storage/AI请求。CSP、浏览器role revocation/RLS、server secret隔离、cost-aware并发/限流/body limits保留；localhost便利不能在公网打开。

**O05 生产后端**（S+D）：账号/Auth/sync/REST/Storage走Docker internal `http://supabase-api:8000`，external SUPABASE_URL生产拒启；browser没有key。Vercel full app/managed Supabase为回退参照，不能架构优化时变新主站或重复部署。`/api/connectivity`公开releaseId/parent/backendMode，不能泄secrets。

**O06 发布与回退**（D，独立测试者需执行）：当前accepted parent dedicated clean worktree、reviewed changedFiles精确delta、sourceRevision exact commit；stable `/opt/context-reader/bin/deploy-release`全局锁/parent recheck/internal-backend/protected contracts始终启用。仅app/caddy无依赖重启，保留current+direct-parent rollback images。build/upload/candidate health不等于上线；公网exact release+parent+mainland_internal及受影响真实回归才算发布。7服务健康、备份恢复、父版回退路径必须保留，不能拿大重写顺便迁库/清数据。

## 12. 合约交付边界与未观察事项

本契约提供完整功能域、页面/接口库存、可追溯源文件以及失败/重试/权限/兼容矩阵，仍不能单凭文本证明“所有排列都等价”。它故意不复制全部源码，也不声称仅根据自然语言从零生成一次就能得到无缺口实现。正确用途是把每次架构替换映射到这里的功能编号，留下变化前后证据，并保留尚未替换/未验证路径。

本次文档审计没有执行：现网写入/付费模型、完整账号角色矩阵、全部历史数据迁移、音素听音、全部CET人工校题、实体手机触摸、其他浏览器、冷网快速滚图、视觉关键帧逐像素比较、支付/退款/SMTP收件、真实06:00日程和连续数月奖励。测试作者需要将实际完成项另记为pass/partial/fail；开放项原样保留，不得以“测试全部通过”概括未覆盖的功能或性能。

架构拆分可以从稳定的纯算法、状态所有权、外部存储订阅、API边界和懒加载依赖做起，前提是上述合约不变。模块更小不是性能证据；必须用相同文章、相同账号/缓存状态、相同设备/网络记录首屏可操作、Reader进入、查词首字/完整结果、目录展开、长文滚动/来源跳转、最大主线程阻塞和内存/请求数的前后结果。
