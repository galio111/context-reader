# 候选文章抓取控制

## 当前状态

2026-09-05：控制功能已部署到大陆生产，并完成真实分类、图片保存及候选入库检查。接受版本为 `20260905T125348`，父版本 `20260905T121527`，源码提交 `e683d54c9f4a8a998e2c1be86237a28fa588cb31`；公网连接检查与当前发布目录均已核对。本轮从大陆服务器检查了 53 个网站配置，18 个通过近期更新、两篇正文及图片可读取的技术检查；其中 New Atlas 样本仍有重复图库信息，保持停用。其余 17 站已启用，其中 3 个是专门的较低难度来源，每站默认目标 2 篇，合计目标 34 篇，不是保底产量。

“约二十几个稳定日常来源”仍未达到，不能把备选网站数量冒充可用数量。网站技术可读取，也不代表每天必然有两篇满足内容筛选的新文章；新批次仍须逐篇检查。长期自动任务需要后续实际运行记录才能证明稳定性。

## 你可以控制什么

- 在后台“批量导入、封面与自动抓取”里添加、移除或停用网站，设置每站每日目标（默认 2，范围 0–10）、订阅地址、主要主题和来源用途。移除网站不删除已收录文章。
- 默认北京时间 06:00 开始，沿用服务器每 5 分钟处理一站的定时任务。关闭电脑不影响运行。手动“抓取本站”与自动任务共用每日额度。
- “低难度专门来源”是找文章的渠道，不是强制分级。Science News Explores、Breaking News English、Level Read 分别提供青少年科普、英语学习新闻和分级阅读；仍按实际词汇、句子与背景知识分类，不保证每篇就是四级。
- 在工作台点“打乱往日候选”，今天加入的文章仍排在前面，其他文章顺序会保存。按北京时间跨天后，昨天新增的文章可以参加下一次打乱。它不修改首页已精选顺序。
- 在阅读资料栏或候选列表点“不精选”，选一个原因后继续下一篇；可以撤销。兴趣和难度反馈会收紧相似内容筛选，正文/广告/图片反馈会显示在来源记录，方便复查，不会未经确认停用整个网站。

## 抓取的具体顺序

1. 从后台启用的网站的 RSS/Atom 或已适配列表读文章，合并同一网站的多个频道。同一网站仍只算一份每日额度。
2. 看最近 14 天的发布时间，最近 3 天须有新作，近期日期间隔的中位数须不大于 3 天。单日密集更新的订阅至少需要 6 个不同时间、跨度 6 小时。未来日期不用于证明更新。
3. 按发布时间从新到旧寻找尚未收录的文章；不是只要“当天发布”的文章。新闻和商业最多 7 天，知识、文化、故事允许长期有效文章。
4. 复用手动 URL 导入的正文边界清理，再用来源专用规则去掉练习、推广框、推荐阅读、捐赠/订阅模块和网站尾注。保留正文叙事与相关图片。
5. 普通原文至少 250 英文词，学习来源至少 180 词；这只是挡住残缺短条目的底线，仍须完整阅读价值检查。广告软文、付费/登录正文、低信息量榜单、八卦、无事实宣传、过于专业的科技文章不入库。
6. 配图先实际下载验格式、大小和尺寸（至少 300×150），再经固定 DNS 安全通路转换并保存到本站图片存储。没有可用图就跳过；不会造图或拿站点标志凑数。图片内容目前结合图片说明与人工审核判断，不声称模型逐像素确认相关性。
7. 依据真实正文判断主题、难度与时效。对既有候选、已精选和不精选记录检查 URL、标题和正文相似度。模型判断不可用时不自动放行。
8. 只写入候选；不自动精选或发布。记录本站新增数量与每篇跳过原因。目标 2 篇时最多 3 批、每批最多尝试 3 篇，重试间隔至少 30 分钟；不够就说明缺口，不用重复或过期文章凑数。

旧问卷中的每天合计 10 篇、3/2/2/3 固定主题篇数和固定难度配额已被后续“每站单独额度、低难度单独找来源”的决定取代。主要主题用于说明来源覆盖；实际全库主题比例取决于启用网站、目标篇数和当天合格内容，不保证固定比例。当前来源分布仍偏科普/文化，商业与综合时事继续补充。

## 逐站核验记录

以下是 2026-09-05 的大陆服务器技术抽样，不是永久访问保证。受阻网站不绕过反爬、登录或付费限制；更新慢的来源不计入日常数量。正式启用状态以后台为准。

| 网站 | 主要覆盖 | 此次检查 | 样本 |
| --- | --- | --- | --- |
| ScienceDaily | 科技科学、自然环境 | 官方 RSS 说明不允许转载完整正文，暂停自动收录。 | [样本 1](https://www.sciencedaily.com/releases/2026/09/260902234508.htm)（1057 词）、[样本 2](https://www.sciencedaily.com/releases/2026/09/260901070543.htm)（807 词） |
| Smithsonian Magazine | 自然环境、文化历史 | 近期有更新，但未验证到两篇完整且有可读取配图的文章，暂停启用。 | — |
| Literary Hub | 故事文学、文化历史 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| Aeon | 文化历史、社会生活、人物成长 | 近期有更新，但未验证到两篇完整且有可读取配图的文章，暂停启用。 | — |
| NASA | 科技科学、自然环境 | 已启用；此次技术抽样通过 | [样本 1](https://science.nasa.gov/image-article/apod-2026-september-4-na-uhane-mahoe-huki-pu-i-ke-ola)（295 词）、[样本 2](https://science.nasa.gov/earth/earth-observatory/a-trio-of-tropical-cyclones-in-the-pacific)（629 词） |
| VOA Learning English | 文化历史、社会生活、人物成长、故事文学、科技科学、自然环境；低难度专门渠道 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| Science News Explores | 科技科学、自然环境、人物成长；低难度专门渠道 | 已启用；此次技术抽样通过 | [样本 1](https://www.snexplores.org/article/sugar-artificial-sweeteners-taste)（1092 词）、[样本 2](https://www.snexplores.org/article/carbohydrates-sugar-nutrition)（2698 词） |
| JSTOR Daily | 文化历史、社会生活、故事文学 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| Undark | 科技科学、社会生活、人物成长 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| Mongabay | 自然环境、科技科学、社会生活 | 已启用；此次技术抽样通过 | [样本 1](https://news.mongabay.com/short-article/2026/09/comparing-green-space-for-urban-cooling-study)（473 词）、[样本 2](https://news.mongabay.com/2026/09/marine-conservation-collides-with-mining-in-indonesias-biodiversity-rich-moramo-bay)（1505 词） |
| The Public Domain Review | 文化历史、故事文学 | 最近更新频率未达日更或每 2–3 天更新，留作备选。 | — |
| Psyche | 人物成长、社会生活、文化历史 | 近期有更新，但未验证到两篇完整且有可读取配图的文章，暂停启用。 | — |
| U.S. National Archives · Pieces of History | 文化历史、社会生活、人物成长 | 最近更新频率未达日更或每 2–3 天更新，留作备选。 | — |
| The Conversation | 科技科学、社会生活、商业经济 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| ScienceAlert | 科技科学、自然环境 | 已启用；此次技术抽样通过 | [样本 1](https://www.sciencealert.com/glp-1-drugs-could-nudge-some-men-toward-hair-loss-study-suggests)（715 词）、[样本 2](https://www.sciencealert.com/massive-analysis-finds-only-3-supplements-show-unrealistically-large-effects-on-depression)（768 词） |
| Colossal | 文化历史 | 已启用；此次技术抽样通过 | [样本 1](https://www.thisiscolossal.com/2026/09/ronald-jackson-portraits-an-american-fiction)（597 词）、[样本 2](https://www.thisiscolossal.com/2026/09/inploration-richelle-ellis-art-space-book)（519 词） |
| France 24 | 社会生活、商业经济 | 近期有更新，但未验证到两篇完整且有可读取配图的文章，暂停启用。 | — |
| NPR | 科技科学、社会生活、人物成长、商业经济 | 近期有更新，但未验证到两篇完整且有可读取配图的文章，暂停启用。 | — |
| Electric Literature | 故事文学、文化历史 | 已启用；此次技术抽样通过 | [样本 1](https://electricliterature.com/7-books-about-writing-the-writer)（1596 词）、[样本 2](https://electricliterature.com/what-if-there-is-no-master-plan-for-your-life)（5781 词） |
| Level Read | 社会生活、科技科学、商业经济；低难度专门渠道 | 已启用；此次技术抽样通过 | [样本 1](https://levelread.com/news/level-3/in-their-80s-still-running-jumping-breaking-records)（213 词）、[样本 2](https://levelread.com/news/level-3/byds-exports-lift-sales-as-chinas-market-cools)（234 词） |
| Knowable Magazine | 科技科学、自然环境 | 最近更新频率未达日更或每 2–3 天更新，留作备选。 | — |
| Econlib | 商业经济 | 最近更新频率未达日更或每 2–3 天更新，留作备选。 | — |
| Harvard Working Knowledge | 商业经济 | 最近更新频率未达日更或每 2–3 天更新，留作备选。 | — |
| Popular Science | 科技科学、自然环境 | 已启用；此次技术抽样通过 | [样本 1](https://www.popsci.com/science/nasas-hubble-superbubble-image)（453 词）、[样本 2](https://www.popsci.com/science/extinct-american-cheetah-evolution)（506 词） |
| Knowledge at Wharton | 商业经济 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| ARTnews | 文化历史 | 近期有更新，但未验证到两篇完整且有可读取配图的文章，暂停启用。 | — |
| English Online | 文化历史、科技科学、社会生活；低难度专门渠道 | 最近更新频率未达日更或每 2–3 天更新，留作备选。 | — |
| Breaking News English | 社会生活、商业经济、科技科学；低难度专门渠道 | 已启用；此次技术抽样通过 | [样本 1](https://breakingnewsenglish.com/2609/260903-manga-theme-park.html)（237 词）、[样本 2](https://breakingnewsenglish.com/2608/260831-destroying-rare-books.html)（238 词） |
| British Council Magazine | 文化历史、社会生活；低难度专门渠道 | 最近更新频率未达日更或每 2–3 天更新，留作备选。 | — |
| News in Levels | 社会生活、商业经济；低难度专门渠道 | 近期有更新，但未验证到两篇完整且有可读取配图的文章，暂停启用。 | — |
| Nieman Lab | 商业经济、社会生活 | 近期有更新，但未验证到两篇完整且有可读取配图的文章，暂停启用。 | — |
| Michigan News | 社会生活、科技科学、商业经济 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| Harvard Gazette | 社会生活、科技科学、文化历史 | 已启用；此次技术抽样通过 | [样本 1](https://news.harvard.edu/gazette/story/2026/09/survey-of-young-researchers-raises-concerns-over-future-of-science-in-u-s)（974 词）、[样本 2](https://news.harvard.edu/gazette/story/2026/09/a-new-diplomacy-for-21st-century-as-economic-political-tech-power-shifts)（948 词） |
| LSE Business Review | 商业经济 | 已启用；此次技术抽样通过 | [样本 1](https://blogs.lse.ac.uk/businessreview/2026/09/04/digital-twins-as-a-new-foundation-of-competitive-advantage)（2086 词）、[样本 2](https://blogs.lse.ac.uk/businessreview/2026/09/02/the-pope-has-a-point-ai-needs-a-referee-that-no-one-owns)（1527 词） |
| Reasons to be Cheerful | 社会生活、文化历史 | 已启用；此次技术抽样通过 | [样本 1](https://reasonstobecheerful.world/the-spark-laundromat-libraries)（1042 词）、[样本 2](https://reasonstobecheerful.world/former-poachers-protecting-forest-nigeria)（1210 词） |
| Inside Climate News | 自然环境、社会生活 | 近期有更新，但未验证到两篇完整且有可读取配图的文章，暂停启用。 | — |
| Fast Company | 商业经济、社会生活 | 近期有更新，但未验证到两篇完整且有可读取配图的文章，暂停启用。 | — |
| The Marginalian | 故事文学、文化历史、人物成长 | 已启用；此次技术抽样通过 | [样本 1](https://www.themarginalian.org/2026/09/04/rumi-love-gold)（784 词）、[样本 2](https://www.themarginalian.org/2026/09/04/turner-liminality-communitas)（670 词） |
| Open Culture | 文化历史、故事文学 | 已启用；此次技术抽样通过 | [样本 1](https://www.openculture.com/2026/09/why-inventing-color-tv-was-so-difficult.html)（763 词）、[样本 2](https://www.openculture.com/2026/09/wes-anderson-picks-nine-of-his-favorite-criterion-films.html)（639 词） |
| TechCrunch | 商业经济、科技科学 | 已启用；此次技术抽样通过 | [样本 1](https://techcrunch.com/2026/09/04/xdof-just-three-months-out-of-stealth-is-in-talks-for-a-series-b-at-a-1-2b-valuation)（487 词）、[样本 2](https://techcrunch.com/2026/09/04/openais-rogue-agents-keep-escaping-with-no-formal-process-to-investigate-them)（835 词） |
| The World of Chinese | 文化历史、社会生活 | 近期有更新，但未验证到两篇完整且有可读取配图的文章，暂停启用。 | — |
| Euronews | 社会生活、商业经济 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| Live Science | 科技科学、自然环境 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| Crunchbase News | 商业经济 | 已启用；此次技术抽样通过 | [样本 1](https://news.crunchbase.com/venture/biggest-funding-rounds-crusoe-fluidstack-multibillion-dollar-ai-infrastructure)（983 词）、[样本 2](https://news.crunchbase.com/venture/nontech-startup-general-counsel-built-legal-tech-gc-ai-ziniti)（1332 词） |
| Global Voices | 社会生活、文化历史 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| ZME Science | 科技科学、自然环境 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| New Atlas | 科技科学、商业经济 | 技术可读取，但图库清洗未验收，不启用 | [样本 1](https://newatlas.com/automotive/china-jeeps-defenders-lookalikes)（942 词）、[样本 2](https://newatlas.com/technology/esphome-starter-kit-review-from-blinking-lights-to-building-a-smart-home)（1138 词） |
| Asian Development Blog | 商业经济、社会生活 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| Economics Observatory | 商业经济 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| Inter Press Service | 社会生活、文化历史、商业经济 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| Japan Today | 社会生活、文化历史、商业经济 | 近期有更新，但未验证到两篇完整且有可读取配图的文章，暂停启用。 | — |
| UN News | 社会生活、商业经济、自然环境 | 订阅或列表暂时无法安全读取，需要复查地址和访问规则。 | — |
| OECD Ecoscope | 商业经济 | 已启用；此次技术抽样通过 | [样本 1](https://oecdecoscope.blog/2026/09/04/measuring-the-macroeconomic-cost-of-climate-change-from-the-ground-up)（1097 词）、[样本 2](https://oecdecoscope.blog/2026/09/03/what-do-card-data-reveal-about-the-impact-of-energy-and-food-shocks-on-european-consumers-everyday-spending)（1040 词） |

## 验收证据

- 本地真实 Admin：网站新增、每日目标从 2 改为 3、拒绝伪造验证后启用、删除专用临时测试网站均通过；只删除测试配置，未删除文章。
- 来源 API 匿名请求返回 401，跨来源写请求返回 403。
- 持久随机排序检查：15 篇原候选全部保留、当天 6 篇顺序和置顶保持，重新读取顺序一致；跨上海日界的可打乱规则有自动测试。
- 桌面真实 Reader 及 390px 手机：原因列表、取消、既有完整移动工具栏、网站编辑表单无横向溢出已检查；未为了测试拒绝或发布现有文章。最终视觉使用感受仍待用户确认。
- 累计生产构建、69 项既有关键回归、10 项抓取策略/提取测试及发布契约通过；生产依赖审计无已知漏洞。上线后再次验证匿名访问边界、管理员来源读取和跨来源写入拒绝。
- 生产真实抓取 Level Read 新增 2 篇候选，实际分类均为“高中 / CET-4”：`b65cb7f9-ada1-4af3-9659-a14f4b07f26e`（In Their 80s, Still Running, Jumping, Breaking Records）和 `1ed41933-b492-464a-aecb-2ea75655a1b4`（BYD's Exports Lift Sales as China's Market Cools）。配图已存到本站公开图片桶，实测返回 200 和 image/webp；同日重复执行返回 already_ran_today，不再增收。该次检查中已发布数量仍为 70，没有自动发布。
- 服务器原定时器保持启用，后续自动批次已成功新增 2 篇；另一个批次未找到合格文章，明确报告 shortfall=2，下一轮仍继续。一次成功不构成长时间稳定性的保证。
- 公网 `/api/connectivity` 返回 backendMode=mainland_internal、releaseId=20260905T125348、parentReleaseId=20260905T121527；`/opt/context-reader-current` 指向对应版本。完整健康检查、最新备份在一次性数据库中的恢复检查通过，父版本回滚镜像存在；应用发布未重启数据库、认证、REST、存储和内部网关。
- 上线后的浏览器自动化打开超时，未据此宣称完成生产界面的视觉验收；上述桌面/手机视觉检查在本地同版完成。用户实际后台使用验收、持续自动运行记录和补足二十几个合格网站仍待完成。
