# Chrome 网页划词助手

入口：`/browser-extension`，首页 Menu 的“浏览器扩展”。支持 Windows 和 macOS 桌面 Chrome；Mac 真机体验仍需实际确认。

## 使用

网站下载 ZIP，解压后在 `chrome://extensions` 开启开发者模式并加载包含 `manifest.json` 的文件夹。下载不会静默安装；正式商店上架尚未办理。安装前打开的网页需刷新。

在网站扩展页选择本浏览器已登录账号并点击“连接所选账号”。该选择只决定扩展查询/生词的归属，不切换网站当前账号。以后切换网站账号不会改变扩展目标；要更改目标，重新连接所选账号。网站可解除指定连接。连接 90 天有效，退出网站不会自动解除这个独立连接。

默认选词后按 `Alt+Shift+D` 查询，也支持选中文字的右键菜单。扩展图标打开设置，通过 Chrome 的快捷键页自行修改组合键。可开启划词自动查询。

1–3 个词显示词语或短语解释。划选至少 4 个英文词会直接翻译所选原文，保留标点，可跨句，最多 5000 字符。周边原句只用来理解语境。点「收藏到好句」会把选中的原文和当时显示的译文存到已连接账号的生词本。重复收藏会更新同一条好句的译文。

选区切到单词中间时，先按原文补齐首尾单词，并同步扩展网页高亮，再按补齐后的词数分流。支持跨 inline 节点、缩写、连字符及带重音的拉丁字母；不会越过空格把相邻完整词加入选区。

浮窗可拖动标题栏移动，拖右下角改变大小；设置页可输入宽高，调整背景不透明度、背景色、文字色和强调色，实时预览并自动保存。透明度只影响背景，文字不随背景变淡。关闭/Esc 隐藏浮窗；再次查询按固定状态恢复位置或贴近选区。

右上角图钉可固定本页弹窗位置。固定后，新查询只更新内容，位置与尺寸保留；点击外部不关闭，仍可拖动、缩放或手动关闭。取消固定后，外部任意点击（包括无字空白）关闭弹窗，下次查询重新贴近选区。外部关闭会使待返回的显示失效，不能被迟到响应重新弹开。弹窗内不显示账号名称或“保存到”提示；保存目标仍在网站设置，后台归属不变。

首页、阅读器和背词里的生词本都有「好句」板块，可按原文或译文检索。收藏即加入网站复习队列，正面显示完整中文译文，翻面显示所选原文。好句按收藏时间排列。服务端用原文的 SHA-256 核验标记，旧网页同步也能保留好句类型。

语境划词的两路响应共用一次用量操作。渐进内容中断时，已结束的字段和完整的结构化释义合并显示。缺少可信音标时保留释义与例句。只有完整解释可以保存或进入缓存。

更新已有安装：下载新 ZIP 并覆盖原扩展文件夹，在 `chrome://extensions` 点击扩展“重新加载”，再刷新要查询的网页。保持相同扩展身份，无需删除扩展或清空设置。

## 上下文与结果

- 从真实 DOM Range 定位所选词的具体出现位置，保留 inline 文本，复用网站 tokenizer 的句界规则，并保留 `Fig. S19` 等跨行图号。
- 只采集所选块的当前句和相邻句。跳过输入框、可编辑区、script/style 和隐藏内容；不能取得完整句时改用独立词典。
- 语境模式直接打包复用 `ExplanationPanel` 与 `PronunciationButtons`，并行请求现有结构化与流式路由。完整流式文本为可见权威，合并后再启用保存；流中断后用完整结构化释义补齐已显示的字段。两路都没有完整结果时清除半截内容，提供重试。
- 扩展凭证仅留在 Chrome trusted storage/后台，不传给宿主网页。网页收到的只是封闭 Shadow DOM 内的扩展 iframe；每次用户取词生成随机 nonce，后台同时校验 nonce、标签页与连接，拒绝未授权嵌入。
- 网站 API 原有 CSP、账号 Cookie、安全策略不放宽。仅精确扩展来源可跨站调用 `/api/extension/execute/*`，各操作仍需有效扩展凭证及活跃账号。
- 保存写入该账号的 `user_data_objects`，复用协议 2 的 CAS，正常同步进入网站生词本。相同词/原句复用现有 id、创建时间和 Anki 导入记录。扩展不直接执行 Anki 导入，可在网站生词本导入。

不支持图片/OCR、Chrome 系统页、应用商店、内置 PDF 阅读器和阻止扩展的页面。本地 HTML/文件网址未申请权限。跨源 iframe、特殊编辑器和画布型网页的取词情况应实测；内容拿不准时查看浮窗底部“取到的原句”。

## 开发和部署

源代码位于 `chrome-extension/src/`。`chrome-extension/identity.json` 是稳定的公开扩展身份，只有公钥，没有私钥；不要重新生成，否则网站连接入口和已安装的扩展会不一致。

```powershell
npm.cmd run build:extension
npm.cmd run test:extension
npm.cmd run verify:release-contracts
npm.cmd run build
```

构建输出为被忽略的 `artifacts/chrome-extension-1113/unpacked/` 以及纳入发布的 `public/downloads/context-reader-chrome.zip`。扩展只运行打包代码，不从网站下载执行远程脚本。更新扩展代码必须重新构建 ZIP、递增 manifest 版本并让用户重新加载/安装；网站代码更新不能自动改变已下载的扩展。

上线前在现有 PostgreSQL 中执行幂等的 `ops/mainland/extension-connections.sql`：只新增连接表，启用 RLS、撤销 anon/authenticated 权限，仅 service_role 可读写。服务端保存随机 256 位凭证的 SHA-256 摘要，查询与保存 API 每次检查到期、撤销、账号状态和真实 Auth 用户。使用 `AsyncLocalStorage` 给现有用量与模型路由提供已验证账号，不把 Cookie/Refresh Token 暴露给扩展，也不接受请求体里的 ownerId。

`scripts/qa-browser-extension.mjs` 在隔离 Chrome 配置中加载真实扩展，使用合成模型/账号响应检查交互。可以设置 `PLAYWRIGHT_MODULE` 和 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指向已安装的测试运行时；新版正式 Chrome 用 `USE_CDP_EXTENSION_LOAD=1` 在该隔离配置中加载开发扩展，不修改用户日常 Chrome 配置。

## 当前验收

网站版本 `20261122T112204` 接受现有扩展 1.3.0 的收藏请求并自动建立背诵卡，保留已有四条好句的原文、译文及收藏时间。[本轮验收](evidence/study-vouchers-20261122.json)。

## 1.3.0 扩展发布验收

生产版本 `20261121T112807`，父版 `20261115T195040`，运行源码 `e015971061c56cf738b9892dedb5b51719761b38`。公开下载包为 1.3.0。Windows Chrome 复现了 1.2.0 在流中断后的半截解释及报错。1.3.0 在最小浮窗可滚至最后的例句、保存与重试。公开下载包通过网站实际连接、划句翻译、收藏、加入背诵、翻面评分与重载检查。Mac 真机和实体快捷键待验。[本轮验收](evidence/lookup-and-sentences-20261121.json)。早期版本的安装、图钉、选择和外观验收见 [1.1](evidence/browser-extension-20261114/acceptance-1.1.json) 和 [1.0](evidence/browser-extension-20261114/acceptance.json)。

## DeepSeek web questions

The owner approved DeepSeek metered search on 2026-11-15. Questions are available after contextual explanations, dictionary lookup and selected-sentence translation. Public person/event keywords are resolved from selected text, surrounding sentences and recent conversation; grammar-only questions skip search. Follow-up history is scoped to the popup and reset on account change.

Search uses the existing server-side DEEPSEEK_API_KEY and https://api.deepseek.com/v1/tools/search. It defaults on; EXTENSION_WEB_SEARCH_ENABLED=false disables it. Search is billed at $0.75 per 1,000 successful nonempty requests, separately from model inference. Only bounded planned keywords are sent to search, not raw webpage/conversation. DeepSeek summaries and publication dates are passed to the answering model; up to five clickable sources accompany the answer. Search failures are disclosed and never claimed as successful retrieval. Website paper-reference behavior remains unchanged. The authenticated extension identity establishes scope server-side.

Version 1.2.0 search acceptance (2026-11-15): authenticated person, event, recent event and follow-up questions returned cited results. Grammar skipped search. See the [web search acceptance record](evidence/extension-web-search-20261115.json).

Official API: https://api-docs.deepseek.com/api/search/ ; billing: https://api-docs.deepseek.com/guides/search/ .
