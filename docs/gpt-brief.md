# Context Reader GPT 项目上下文包

这份文档用于把 Context Reader 的项目背景、产品目标、技术现状、用户偏好和重要约束同步给 ChatGPT。首选做法是在 ChatGPT 的“设置 → 插件（官方帮助文档也称 Apps）”中连接 GitHub，并授权 `galio111/context-reader`：这样 GPT 可以按需搜索默认分支中的当前代码、`AGENTS.md`、README 和 `docs/`。开始讨论时可直接 `@GitHub`，明确指定仓库并要求先读取 `AGENTS.md` 和相关文档。

GitHub 只包含已经提交并推送的状态，不能读取未提交的本地改动、Codex 记忆、浏览器 `localStorage`、Vercel/Supabase 私有数据或密钥。每个重要开发阶段结束后，先让 Codex 对齐代码、项目文档和记忆，再构建、部署并推送 GitHub；之后 GPT 才能看到这一版。ChatGPT 的 GitHub 连接用于读取和分析，不应被当作写入仓库的发布工具，代码修改与推送仍交给 Codex。

这份 `gpt-brief` 不再承担每次手工上传的唯一入口，而是保留为精炼的产品意图、设计边界和故障恢复包。当 GitHub 连接暂不可用、仓库尚未完成索引，或需要把上下文带到不能访问仓库的会话时，再上传或粘贴本文件。

如果这份文档和代码、`AGENTS.md`、`README.md` 或 `docs/architecture.md` 冲突，以当前代码和 `AGENTS.md` 为准，并让 Codex 先核对。

## 1. 项目一句话

Context Reader 是一个面向中文母语英语学习者的 Next.js 阅读工具。当前正式 `/home-v2` 入口支持粘贴英文文章和导入公开 URL 文章；旧版共享代码仍保留 OCR 能力，但正式首页不提供图片上传。用户可以保存文章，在阅读时点击单词或划选短语获得中文语境解释，把有价值的词汇保存到本地词汇本，并导出 CSV 或通过 AnkiConnect 导入 Anki。它还支持全文翻译、文章编辑、公开推荐文章、管理员预缓存解释和翻译，以及有限的 PWA 离线能力。

固定生产地址：

```text
https://context-reader-ten.vercel.app
```

## 2. 目标用户和核心场景

目标用户是中文母语的英语阅读者，主要需求不是刷题，也不是背单词游戏，而是在真实英文文章里降低理解阻力。

典型使用流程：

1. 打开首页。
2. 粘贴英文文章、导入公开网页 URL，或打开已保存/推荐文章；正式首页不提供图片上传。
3. 在阅读中点击陌生单词，或横向划选短语。
4. 右侧解释面板逐步显示中文语境解释。
5. 把重要词汇保存到词汇本。
6. 后续导出 CSV，或通过本地 AnkiConnect 导入 Anki。
7. 需要时在右侧栏启动全文翻译。
8. 发现文章内容需要调整时，在阅读画布里直接编辑并保存。

产品成功标准：

- 阅读本身始终是主体验，文章排版不能被工具 UI 抢走。
- 查词和短语解释要快、稳定、尽量不打断阅读。
- 解释必须结合上下文，而不是只给词典释义。
- 学习资料要耐用：IPA 音标、源句、上下文含义、例句、Anki 字段都要保留。
- 移动端竖向滚动不能误触发查词。
- 用户的本地文章、词汇、解释缓存、翻译缓存不能被轻易破坏。

## 3. 产品性格和设计偏好

阅读界面应当安静、克制、实用并适合长时间阅读。首页可以承担更强的宣传和教学作用，但必须围绕真实的点词、划短语和开始阅读入口展开，不能变成通用 AI 官网、游戏化学习产品或社交信息流。

设计偏好：

- 保持阅读优先，文章文本是视觉锚点。
- 控件紧凑、清晰、第一屏可用。
- 可以有信息密度，但不能混乱。
- 首页可以有设计工作室式的空间连续性和动效，但不能套用通用 AI landing page 文案与卡片模板。
- 用户明确喜欢原首页中随桌面鼠标移动产生彩色英文字母的效果。这是已确认的品牌动效，不应擅自弱化或藏到不透明书页下面；它在闭合封面、展开书页、按钮、表单、Menu 和弹层上都应清楚可见，只在文章正文与解释阅读区域避让，进入正式 ReaderView 后完全消失。手机端只保留轻微触点涟漪，不持续生成跟手字母。
- 不要全局黑色顶栏。
- 不要嵌套卡片、巨大装饰渐变、花哨 hero、过度游戏化语言。
- 编辑文章时必须保持阅读模式的排版，不要跳到 textarea 或卡片编辑器。
- 工具面板关闭再打开时，临时状态应尽量重置；但文章、词汇、缓存等耐久数据必须保留。

## 4. 当前技术栈

主要栈：

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- DeepSeek API
- OpenAI SDK 依赖存在，但主要 AI 路由目前默认走 DeepSeek
- Supabase 用于公开推荐文章、手机号标识 + 6 位数字密码账号（邮箱 OTP 仅保留兼容）、用量计数和跨设备学习数据同步
- 浏览器 localStorage 用于本地优先数据、离线缓存和账号同步；保存文章始终合并为每篇一条，不展示恢复副本
- AnkiConnect 用于本地 Anki 导入
- PWA service worker 用于有限离线能力
- Three.js 用于 `/home-v2` 封面的被动漂浮球体场景；GSAP 用于悬浮胶囊按钮；MIT `page-flip` 用于滚动进度控制的单张曲面翻页

常用命令：

```powershell
cd context-reader
npm install
npm run dev
npm run build
npm.cmd exec -- vercel --prod --yes
```

Context Reader 代码变更后的常规要求：

1. 运行 `npm.cmd run build`。
2. 部署 `npm.cmd exec -- vercel --prod --yes`。
3. 部署完成要确认固定生产 URL 指向最新版本。

纯文档变更通常不需要 build/deploy。

## 5. 项目目录速览

重要路径：

```text
context-reader/
  app/
    page.tsx
    admin/page.tsx
    admin/accounts/page.tsx
    account/usage/page.tsx
    api/
      auth/*/route.ts
      account/sync/route.ts
      account/export/route.ts
      usage/cache-lookup/route.ts
      explain-word/route.ts
      explain-word-stream/route.ts
      dictionary/route.ts
      translate-article/route.ts
      download-image/route.ts
      import-url/route.ts
      public-articles/route.ts
      admin/*/route.ts
      anki/*/route.ts
      ocr-image*/route.ts
      ocr-image-layout/route.ts
    guide/page.tsx
  components/
    AccountProvider.tsx
    ArticleInput.tsx
    BookHome.tsx
    BookHome.module.css
    BookDictionary.tsx
    CurvedPageTurn.tsx
    HomeOptionMenu.tsx
    Ballpit.tsx
    OptionWheel.tsx
    PillNavAction.tsx
    ImmersiveHome.tsx
    HomeReadingDemo.tsx
    HomeClient.tsx
    ReaderView.tsx
    ExplanationPanel.tsx
    ArticleTranslationPanel.tsx
    VocabularyPanel.tsx
    PronunciationButtons.tsx
  lib/
    userAuth.ts
    accountStore.ts
    accountSyncClient.ts
    usageIdentity.ts
    usageGate.ts
    deepseek.ts
    apiClient.ts
    tokenizer.ts
    cache.ts
    vocabulary.ts
    articles.ts
    articleTranslationBlocks.ts
    articleTranslationJobs.ts
    displayLabels.ts
    explanationDisplay.ts
    sourceMatching.ts
    publicArticles.ts
    ankiConnect.ts
    ankiData.ts
    ankiTemplates.ts
    visionOcr.ts
  types/
    account.ts
    reader.ts
    vocabulary.ts
    article.ts
    publicArticle.ts
    anki.ts
  docs/
    account-usage-plan.md
    account-usage-supabase.sql
    architecture.md
    integration-guide.md
    public-articles-supabase.sql
    home-complete-ui-prototype.html
    home-direction-1-workbench.html
    home-direction-2-command.html
    gpt-brief.md
```

## 6. 主要数据模型

### 文章

保存文章 `SavedArticle` 大致包含：

- `id`
- `title`
- `summary`
- `body`
- `importedArticle`
- `createdAt`
- `updatedAt`
- `lastOpenedAt`（可选；首页已保存文章菜单用它按最近打开排序，旧数据回退到 `updatedAt` / `createdAt`）

URL 导入文章会保留 `ImportedArticle`：

- `title`
- `url`
- `siteName`
- `text`
- `blocks`
- `style`

`blocks` 可包含：

- `heading`
- `subheading`
- `paragraph`
- `list-item`
- `quote`
- `image`

图片 block 可以包含 `src`、`alt`、`ocrText`、`layoutWords`、`layoutError`。旧版图片导入逻辑可以并行请求文本 OCR 和词框识别，只有成功保存了 `layoutWords` 的图片才支持按图中文字位置点击解释；当前 `/home-v2` 不暴露图片上传入口。

导入文章必须保留结构化信息，包括标题、段落、列表、引用、图片、图片 `ocrText`、以及 `sup`/`sub` 上下标 inline 片段。保存再打开时不能退化成纯文本。

### 词汇

词汇条目 `VocabularyEntry` 包含：

- `id`
- `word`
- `lemma`
- `phonetic`
- `partOfSpeech`
- `basicMeaning`
- `contextMeaning`
- `sentenceTranslation`
- `usageNote`
- `collocation`
- `exampleEnglish`
- `exampleChinese`
- `sourceSentence`
- `previousSentence`
- `nextSentence`
- `difficulty`
- `shouldAddToVocabulary`
- `createdAt`
- `anki`

音标是强要求：解释、词汇本、复制内容、CSV、Anki 字段中都要尽量保留 IPA phonetic transcription。

## 7. AI 模型和路由原则

DeepSeek 相关路由默认使用：

```text
deepseek-v4-pro
thinking: { type: "disabled" }
```

环境变量可以覆盖模型，但代码和文档示例默认应继续使用 Pro 模型，除非用户明确要求改。

模型覆盖与回退：

- `DEEPSEEK_MODEL` 是共享模型覆盖。
- `DEEPSEEK_TRANSLATION_MODEL` 只覆盖全文翻译。
- `DEEPSEEK_FALLBACK_MODELS` 是主 Provider 上的逗号分隔回退模型列表。
- `DEEPSEEK_FALLBACK_BASE_URL`、`DEEPSEEK_FALLBACK_API_KEY`、`DEEPSEEK_FALLBACK_MODEL` 可为结构化单词解释配置备用 Provider。

主要 AI/API 路由：

- `/api/explain-word`：结构化单词/短语解释。
- `/api/explain-word-stream`：流式解释，负责用户可见的逐步输出。
- `/api/dictionary`：无原句时的独立深度词典；接受一个英文单词或不超过 8 个词的短语，计一次 `lookup_generation`。
- `/api/dictionary-stream`：以逐行 JSON 事件直接流式生成最终独立词典 UI；事件累计结果就是可缓存、可保存的完整词条，结束时不替换布局。
- `/api/ask-sentence`：围绕句子的提问。
- `/api/translate-article`：全文翻译，按文章 text block 返回 id 对齐翻译。
- `/api/summarize-article`：文章摘要。
- `/api/import-url`：导入公开网页并解析结构化文章。
- `/api/ocr-image`：旧版/共享图片导入路径使用的文本 OCR；正式首页没有入口。
- `/api/ocr-image-layout`：旧版/共享路径可对上传图片、data URL 或远程图片做词框识别。
- `/api/ocr-image-url`：远程图片文本 OCR；URL 导入文章的阅读器目前不会自动调用。
- `/api/download-image`：阅读器远程图片下载代理。
- `/api/public-articles` 和 `/api/public-articles/[id]`：公开推荐文章读取。
- `/api/auth/*`：手机号 + 6 位数字密码注册登录、兼容邮箱 OTP/托管登录会话、当前会话与退出。
- `/api/account/sync` 与 `/api/account/export`：版本化学习数据同步与账号数据导出。
- `/api/usage/cache-lookup`：记录游客缓存查词试用。
- `/api/admin/*`：开发者账号或备用密码管理员的推荐文章发布/删除、账号套餐、额度和反馈管理；前端是否显示入口不是鉴权边界。
- `/api/anki/*`：Anki 辅助路由，实际导入仍依赖本地 AnkiConnect。

## 8. 查词和解释流

查词是 Context Reader 的核心。用户点击单词或划选短语后，客户端会使用选中文本、当前句、前一句、后一句作为上下文。

在缓存未命中时，客户端会并行启动：

- `/api/explain-word-stream`
- `/api/explain-word`

关键规则：

- 流式解释要直接渲染在最终 `ExplanationPanel` 的视觉结构中。
- 流式内容完成后，它的可见字段要合并进结构化 JSON。
- 缓存的是合并后的解释。
- 完成后不能把用户看到的流式解释替换成另一份独立生成的结构化解释。
- 新鲜流式显示、完成显示、缓存回放必须内容一致、字段顺序一致、间距一致、宽度和视觉树一致。
- 结构化结果仍然提供隐藏/耐久字段，例如 Anki metadata。
- 操作按钮必须等 stream 和 structured 两个请求都完成后再出现。
- 保持稳定 scrollbar gutter，避免操作按钮出现时解释文本宽度跳动。
- 常见搭配必须包含简洁中文释义，例如 `take shape（成形）`。
- 如果同一个 word/phrase + source sentence 已经在词汇本里，点击圆形重新生成应当替换该条目的生成字段，但保留 id、创建时间和 Anki 导入记录。

重要体验要求：

- “failed to fetch” 通常意味着请求失败、超时、网络/API/Vercel 问题，未必是模型本身坏了。
- 全文翻译和划词解释可能并发发请求，因此前端要避免互相中断、抢状态或错误复用。
- 划词解释和全文翻译应是两个独立任务流：切回查词面板不能取消全文翻译。

## 9. 全文翻译

全文翻译位于阅读页右侧栏，不在顶部工具栏。

用户进入翻译侧栏时不能自动开始翻译，必须由用户在侧栏里点击启动。只有用户已经请求过翻译后，侧栏才应显示进度或缓存结果。

翻译原则：

- 使用 `/api/translate-article`。
- 只翻译文章 text blocks，不翻译图片本身。
- 请求和返回都必须 id 对齐。
- 长文章在客户端按 block 分批，当前偏好是一段一段请求，这样第一段完成后能立即显示。
- 每个分批请求可以同时携带当前整篇文章作为 `contextBlocks`，让模型在一段一段输出时仍能参考全文语境、术语和代词关系。
- 翻译进行中，用户切回单词解释或短暂离开文章，翻译不应中断。
- 翻译缓存存于浏览器 `localStorage`；每完成一段就立即更新整篇进度缓存和 per-block 缓存，并作为独立账号对象进入同步，不能等全文成功后才落盘，也不依赖用户先保存文章。因此登录用户即使没有保存推荐文章，也能在另一浏览器打开同一推荐后恢复全文/部分翻译并只续跑缺失段落；Admin 预载翻译和解释只填补缺失 cache key，不能覆盖用户账号恢复的缓存。
- 既有整篇合并缓存，也有可复用的 per-block 缓存。中途刷新、离开文章、浏览器重启或短暂报错后，应保留已完成段落并只续翻缺失段。
- 真实的 429 限流、500/503、超时和网络闪断使用可取消的排队与指数退避自动继续；额度耗尽、提供商余额不足和 API 配置错误必须单独说明，不能笼统显示成“繁忙”。
- 文章编辑后，未改变的 block 应复用旧翻译，改变的 block 标记为需要更新。
- “更新已修改部分”应该只请求变更 block，而不是整篇重译。
- 删除文章段落后，对应翻译也应从显示和缓存逻辑里消失。
- “原文已修改，译文可能过期”这类提示只应在顶部或总体位置显示，不要每段重复刷屏。
- 圆形重新生成按钮才表示强制重翻整篇；它应先清除当前文章匹配的整篇翻译缓存和 per-block 缓存，再重翻所有当前 text blocks、发送全文上下文，不能把旧译文误判成已经完成的新一轮结果。

用户对全文翻译的明确不满：

- 只是删除前几段，不应该导致全文全部重来。
- 每一段都显示过期提示很烦，应该只在最上方提示。
- 如果只是删除段落，理想上更新后应删除对应译文，而不是让所有段落重新生成。

## 10. 文章编辑

文章编辑必须保持“在阅读画布中直接编辑”。

严禁方向：

- 不要把文章替换成 textarea。
- 不要打开单独的卡片编辑器。
- 不要进入编辑后改变文章字体、宽度、行高、段落间距或整体排版。
- 不要在每次按键时用 React 受控 state 重绘 `contentEditable`，这会导致光标乱跳。

当前规则：

- 编辑模式复用阅读模式 typography 和 paragraph classes。
- 编辑时禁用查词。
- 图片内容只读，不可编辑、不可上传替换；编辑模式允许通过图片右上角删除按钮移除整个图片 block。
- 粘贴/导入文章里的显式空行是用户内容，应允许存在。
- 不应把用户手动保留的空行自动删掉。
- 空的列表项如果只是图片/导入内容旁边残留的项目符号，应在保存时清掉，不要让用户必须先保存再消失。
- 短粘贴纯文本文章和 URL 导入的 block 文章都要保留显式空段落。
- no-op 保存不应重写文章或改变布局。
- 保存后持久化到 localStorage。
- `SavedArticle.importedArticle` 必须保留 rich blocks。
- 修改导入文章 text block 后，如果纯文本不再匹配原 inline segments，可以丢弃该 block 的 inline segments，但图片 block 必须保留。

撤销/重做约束：

- 撤销/重做要设为阅读会话内全局能力，不要只在点击编辑后才有。
- 不要显示“撤销保存”这类复杂概念。
- 只要浏览器未关闭、且用户没有回到首页，工具栏 undo/redo 应能一步步回退每次文章操作，包括已保存后的编辑状态。
- 这不是浏览器原生 undo/redo，而是 Context Reader 自己维护的 session history。

## 11. 阅读交互

桌面端：

- 点击单词触发解释。
- 拖动/划选短语触发短语解释。
- 阅读视图右侧可以切换解释、全文翻译、词汇等工具。

移动端：

- 竖向滚动必须被视为阅读滚动，不能误高亮或查询单词。
- 短语选择应要求明显横向移动，或长按选择。
- 解释 bottom sheet 默认半屏高度。
- bottom sheet 可由用户调整高度。
- 只有紧凑的 collapse 控制固定，内容自身滚动。

## 12. 词汇本

词汇本是本地学习资产，不应被轻易清空或覆盖。

规则：

- 词汇以压缩格式保存在 localStorage；读取仍兼容既有的未压缩数据，并在后续写入时无损迁移。
- 词汇卡片要根据内容实测并自适应高度，展开扩展释义后也要重新测量。
- 默认态常显音标和原有核心内容；用法、搭配、双语例句只在点击“显示全文”后出现。展开控制只做渐进披露，不能用来掩盖固定行高或截断问题。
- 独立查词保存的词条没有原句：折叠态只显示合并中文义项，不渲染空原句/翻译；展开态把用法拆成逐点独立行，并把搭配、例句、近义词辨析、词族、易错点和记忆提示分别呈现。旧版合并保存的字符串也要解析成相同结构。
- 生词始终按 `createdAt` 倒序排列，登录合并云端数据后也不能继承云端对象键的字母顺序。大词汇本使用动态高度虚拟列表，只挂载视口附近的词条；未测量行用内容长度估算高度，ResizeObserver 更新按动画帧批处理，拖动滚动条时不因新测量行而补写滚动偏移。不要在每个滚动事件里更新 React 状态，也不要让每个虚拟行重复初始化浏览器 TTS。
- 短条目要紧凑，长条目要完整可见。
- 首页词汇本是居中的顶部 dialog。
- 阅读页词汇本是右侧 drawer。
- 两种入口打开词汇本时都要锁定底层页面滚动，关闭后恢复原滚动位置；词汇列表必须保留独立、明确高度的内部滚动区域并隔离 overscroll，首页的全局滚轮教学锁和场景吸附不得拦截词汇本内部的滚轮或触摸事件。词汇本打开期间要暂停被遮住的首页动画帧和 CSS 动画，遮罩不得使用整屏 backdrop blur，以免列表滚动触发昂贵的背景合成。
- 打开/关闭词汇本时，搜索词、预览弹窗、临时错误、Anki 状态等临时 UI 应重置。

## 13. 发音和 Anki

发音：

- 解释和词汇本中应提供紧凑的浏览器 TTS 播放控件。
- 需要 US 和 UK 两种发音入口。
- 两个控件始终可见；浏览器不支持 `SpeechSynthesis` 时，点击后说明能力限制，不能直接隐藏入口。

Anki：

- 通过本地 AnkiConnect 导入。
- Anki 必须打开，AnkiConnect 必须安装。
- `/guide` 是面向新人的完整使用指南：先解释网站用途和第一次阅读流程，再对比语境背词与孤立词表，最后介绍 Anki、日常学习循环和分组 FAQ。它提供三步 Anki 安装助手，识别当前设备，打开官方桌面版下载页，一键复制 AnkiConnect 插件代码 `2055492159`，测试本机连接，并在失败时显示排查顺序与可复制的生产域名跨域配置。浏览器不能静默安装桌面软件，所以不要把它描述成真正的一键安装。
- Context Reader 会创建或更新自己的 Anki note templates。
- 卡片背面应使用 Anki 原生 TTS replay controls。
- 不下载、不保存音频媒体文件。
- UK 控件应请求 `en_GB`，但不写死 voice candidates，由 Anki 从系统已安装的英音中选择。
- 导入时应尝试通过 AnkiConnect 把目标 deck config 的 audio autoplay 设为 `false`，让用户点击后才播放。
- 如果 deck config 写入失败，note import 仍应继续。
- 独立查词词条使用 `basic_en_to_cn`：正面只有英文；背面是完整复习面，包含中文义项、原形/词性/音标、美音与英音 TTS、用法分点、搭配、近义词辨析、词族、例句、易错点和记忆提示。文章词条原有挖空卡和中译英回退卡不变。

Cloze 卡强规则：

- 正面先显示 cloze sentence。
- 大留白之后，只显示最新耐久 `contextMeaning`。
- 不要显示 basic meaning。
- 不要显示字段标签。
- 不要截断。
- 不要显示 sentence translation。
- 不要用 fallback 或模型提供的 cue 替代。

## 14. 首页和推荐文章

`/home-v2` 是当前正式主页，`/` 自动跳转到它。封面外始终保留“开始阅读”动作，展开后的开始阅读页把独立查词、粘贴文章和输入网址作为三个同级模式。独立查词带美式/英式发音，逐块流出的内容就是最终 UI，并与文章阅读页右栏的第三个“单独查词”工具共用当前标签页会话和生词本保存规则。Menu 未打开时沿用既有按钮，点击后从右侧依次滑入彩色底板、主面板和菜单文字。菜单项严格按“使用说明、生词本、保存文章、账号与用量、意见反馈”排列，只有服务端确认的开发者账号才在末尾看到“admin后台”。所有普通条目都在左侧原位预览，桌面上沿与对应菜单行对齐；鼠标移入预览操作时不会消失，只有切换目标或关闭 Menu 才会收起。使用说明和账号用量复用完整页面主体并独立滚动；生词本使用全量虚拟列表和有序前缀索引，滚动时冻结悬停详情，检索和下滑都不随总词数线性重做渲染；意见反馈使用更宽的表单并可附加最多三张私有图片。只有“admin后台”跳转页面。Menu 内没有退出登录，退出入口位于 `/account/usage`，退出前必须先成功同步并返回 `/home-v2`。保存文章每篇逻辑文章只出现一次，并按最后一次打开时间倒序排列。旧的同正文记录和 `-local-recovered-*` 血缘副本会合并回原文章并同步删除。

公开推荐文章：

- 由 Supabase 存储。
- 首页推荐列表必须由 server render 加载并传给 client 作为 initial data。
- 不应只在 mount 后 client fetch，否则返回首页时会出现推荐区域短暂为空。
- 新推荐先保存为 `public_articles.published=false` 的候选；难度、人群、主题、时长、时效和封面信息放在 `imported_article.recommendation`。
- 推荐封面是发布必需项；正文内图片可选，URL 原文有有效配图时要保留。

旧版四屏沉浸式主页及其图片入口仅作为历史实现保留，不再代表当前生产结构。当前生产首页以以下 `/home-v2` 书本空间为唯一视觉与交互来源：

同项目的 `/home-v2` 是当前正式主页和首页实现的唯一来源，`/` 自动跳转到 `/home-v2`；使用说明、Admin、账号用量、账号退出、Anki 连接完成、PWA 启动和离线页等所有“返回主页”入口都必须回到 `/home-v2`。当前权威交互契约位于 `docs/home-v2-implementation-contract.md`。首页初始是一本文字正面与无字背面分离、有封面厚度、纸芯和接触阴影的闭合数字书；首帧已经存在与后续章节共用的完整滚动轨道和滚动条。点击或向下滚动可打开，封面和内页都以滚动位置为唯一动画时间轴，不再使用不可打断的计时器：任意中间帧改为上滚时，封面角度、纸张曲率、遮挡和阴影必须从当前帧精确倒放。硬质前封面始终保持固定半书宽，只允许铰链轴平移和整板旋转；背板与纸芯独立展开到右半页，不能拉伸封面伪造双页。点击目录跨章节时只生成一张当前页直达目标页的纸，不能为被跳过的章节排队多翻一次。界面不再使用 `CR` 方块标，顶部不铺整条栏，只保留悬浮的 `Context Reader`、开始阅读与 Menu；封面主标题也是 `Context Reader`，副标题为“语境翻译魔法书”。打开后始终只有一个固定书本场景，顺序固定为“开发者的话、开始阅读、推荐文章”：开发者前言左页留白，右页在封面完全落定后再保留约 280ms 的纯空白，随后大标题按字形从行内裁切区依次翻起，正文按语义段落连续揭开，签名最后落定；开始阅读页左侧使用真实微型文章和正式 `ExplanationPanel`，右侧默认打开独立查词，同时保留粘贴文章与输入 URL 两个同页 Tab，继续阅读仅在确有历史时出现。旧的整页阅读偏好夹页已经删除，推荐页保留和其他展开页一致的中央书脊、右上“每日更新”和个性化推荐按钮；阶段/考试路线、强度和兴趣改在可滚动弹窗中选择，保存后立即刷新。没有个性化资料时先从四级、六级、考研、雅思和托福库存中按日稳定换序，库存不足才回退到全部有封面的公开文章。以后有阅读记录时应自动推测合适阶段并允许用户手动修改，当前不伪造已完成的阅读画像。推荐列表仍由 server render 注入，缺封面的公开文章不会进入目录；已发布库存为空时显示明确空状态，不伪造文章。用户已选择 B 混合书本引擎：自定义 3D 书壳在开书前后持续保留同一封面、封底、书脊和左右纸芯；`CurvedPageTurn` 克隆当前/目标 DOM 展开页，并由 MIT `page-flip` 动态弯曲为一整张有正反内容和移动遮挡的纸。快照层必须完全不可交互，真实页切换后要立即结束昂贵绘制并保持文字清晰。Wawa R3F 只作为翻页弧线、纸堆和光影参考。761–1280 px 窄桌面保持至少 1160 px 展开宽度并对称裁边，手机和 reduced-motion 使用较短的页边掠过。推荐封面仍可全屏展开并进入原有 `ReaderView`。桌面鼠标彩色字母位于书本、按钮、表单与弹层之上，只对当前可见的正文和解释阅读区做遮罩避让，隐藏展开页不得擦除前言左页字母；进入 Reader 后书本场景和桌面字母层都会卸载。输入框与可编辑区域保留正常可见的原生选词。手机端使用单页书，先显示开发者寄语，再把体验页和查词/导入页分开，只有轻微触点涟漪。主页图片上传仍移除，默认无声音。

前言的流式揭幕只属于从闭合封面首次进入开发者页。前言一旦参与内页翻动，就切换成完整的印刷页状态；从开始阅读或推荐文章向前翻回时，翻动纸张的 DOM 快照必须已经包含全部标题、正文和签名，文字随纸面一起出现，落定后不得再补渲染或重新播放揭幕。只有把封面完整合上，才重新允许下一次开封揭幕。

补充翻页时序：滚动位置仍是唯一姿态时间轴，但封面或内页一旦进入翻动区间，滚轮、触摸或滚动键停止约 90ms 后会沿最后方向自动收完当前这一张纸，剩余收尾最长约 480ms。自动段必须保留 `soft` 纸张密度、正弦页角抬升、纸张背面、遮挡关系和移动接触阴影，不得使用会在前四分之一时段跳过大部分中段曲率的激进缓动。任意新的正向或反向输入都必须先取消收尾，再从当前帧接管。点击封面或目录使用最长约 620ms 的同一套可打断滚动驱动，不再依赖浏览器原生 `smooth` 时长；跨目录仍只翻一张直达目标页的纸。

纸面效果的防回退规则：`CurvedPageTurn` 的快照页必须保持 `soft` 密度、下页角折入、正弦中段抬升和随进度移动的接触阴影；page-flip 外层必须允许曲面溢出。引擎即使视觉隐藏也必须保持 `display:block` 和完整书页尺寸，不能用 `display:none`，否则同帧 `seek` 会量到 `0×0`，把纸张推到视口左上角。翻页端点分别使用极小的渲染 epsilon 和较大的滚动取整 epsilon；落定时先把真实目标页设为活动页，再在下一帧清理临时纸张，新输入要取消待执行清理。否则会出现翻完闪一下并露回旧页。以后修改书本引擎或尺寸，至少要验证两张纸的正反向、半途反转和跨页目录直达，且落定后只能显示一个真实展开页。完整参数见 `docs/home-v2-implementation-contract.md`。

- `context-reader/docs/home-direction-1-workbench.html`
- `context-reader/docs/home-direction-2-command.html`

`docs/visual-metaphors-demo.html`、`.codex/visualizations/2026/07/11/home-metaphor-compare/visual-metaphors.html` 和 `docs/home-complete-ui-prototype.html` 都是早期视觉参考；`components/ImmersiveHome.tsx` 与 `ArticleInput` 仅保留旧版/共享逻辑，不能再作为生产首页设计基线。当前唯一基线是 `components/BookHome.tsx` 与 `docs/home-v2-implementation-contract.md`。实现借鉴设计工作室网站的空间连续性，但不复制参考网站的专有代码或素材。

方向 1：

- 把首页作为 reading workbench。
- 粘贴/导入 workspace 是主视觉。
- 轻量推荐在其下方。
- 已保存文章在右 rail。

方向 2：

- 把首页作为 command-style reading entry。
- 已保存文章和推荐文章位于下方。

后续调整应以已实现首页和 `PRODUCT.md` 的阅读优先原则为准，不要把历史 mockup 当作当前需求。

## 15. Admin 和公开预缓存

Context Reader 有 `/admin` 网站，主要用于上传推荐文章和预缓存。

Supabase 表：

- `public_articles`
- `public_explanations`
- `public_article_translations`

Admin 功能：

- 主入口是服务端确认 `plan_id=admin` 的开发者账号；`ADMIN_PASSWORD` 只保留为恢复登录。
- 本地已保存文章、粘贴文章与输入 URL 是同级入口，共用同一个候选编辑器；URL 导入会保留有效正文图片，并返回可选封面候选。手动 URL 与系统自动候选抓取必须复用同一个 `/api/import-url` 正文边界：按嵌套 DOM 容器剔除导航、引用/来源、相关阅读、推荐、评论、订阅和社交模块，再用块级结束标记兜底，不能把站点尾部杂项写入正文。旧的远程 URL 候选在 Admin 读取和发布前还会经过 `lib/articleContentSanitizer.ts` 的同类尾部清理，发布时写回干净正文；纯粘贴文章不参与该兼容清理。
- 自动判断适合中国学习者的难度、CEFR 参考、人群、兴趣主题、阅读时间和时效属性；这些结果由系统负责，不要求管理员手动选择类型。
- 编辑器只保存候选，不直接发布；发布入口只存在于候选列表。候选与已发布推荐都直接打开正式 `ReaderView`，不是另做一套预览组件。
- 开发者账号在首页账号菜单和书本 Menu 中独占“管理后台”入口；服务端再次验证 `user_entitlements.plan_id=admin`。ReaderView 内的查词、全文翻译、生词本、保存文章和原位编辑与普通阅读完全一致，学习数据归开发者账号同步。保存正文编辑时必须回写对应候选或公开推荐；标题、摘要、分类与封面仍由 Admin 元数据编辑器管理。
- 没有封面可以保存候选，但会进入“缺少封面”提醒且不能发布。
- 支持候选 batch publishing，但必须是选择具体且封面完备的候选后只发布所选项。
- `/admin` 支持按主题、可选难度和目标库存运行自动发现；抓取器只读取代码白名单中的官方 RSS/Atom 来源，自动去重，通过与手动 URL 完全相同的正文清理后再分类并保存为候选，不会自动发布。
- Vercel Cron 每天约北京时间 03:00 轮换一个主题，每次最多补充 2 篇、目标库存 6 篇；`/api/cron/recommendations` 必须通过独立 `CRON_SECRET` 验证。
- 重新发布已公开文章时，应 merge/update 预缓存解释和全文翻译，而不是创建重复推荐。
- 管理员可以删除公开推荐。
- 已公开文章的预缓存更新是该公开文章行上的维护动作，不再另设一套“本地文章发布/批量选择”界面。
- 发布文章时应上传匹配的本地 word explanation cache。
- 发布文章时应上传匹配的本地 full-article translation cache。
- 访客打开公开推荐文章时，返回的 translation caches 应先写入浏览器 localStorage，再进入 reader。
- `article-covers` 上传使用 Supabase Storage 的公开 `public-article-covers` bucket，不调用 OCR。
- “账号与用量”只展示需要管理员理解和调整的普通用户规则：游客、免费、Basic、Plus、Max 的中文查词次数和深度阅读点数。开发者账号的百万级保护额度、原始 metric key、固定 day/month 字段和未接支付的价格配置不显示。
- 用户列表保留套餐分配、封禁、周期用量清零和临时密码；每周期额外额度属于少用操作，折叠在“更多账号操作”中。
- `/admin?section=feedback` 读取私有 `context-reader-feedback` Storage 中的用户反馈，显示类别、时间、内容、可选联系方式、来源页面和私有图片预览，并支持标为已处理、重新打开和删除；附件只经管理员接口读取，删除反馈时一并删除，不显示 user-agent 或 Storage 路径。
- `/admin?section=errors` 读取同一私有 Storage 中按天、版本和错误指纹聚合的站点/API/上游/浏览器异常，显示错误编号、发生次数、用户与部署信息、HTTP/代码、技术消息、堆栈、安全元数据和邮件状态，并支持解决、重新打开和删除。断网和用户输入错误不进入这里。

统一错误体验：

- 用户永远不直接看到 `Failed to fetch`。明确断网时提示检查 Wi-Fi、移动网络或代理，并说明本机文章、生词本和已有缓存仍可用；浏览器在线但站点不可达时，同时说明可能是网络/代理或本站暂时不可用。
- 独立查词在请求前识别中文和整句：中文说明当前尚不支持中译英，整句说明只接受英文单词或不超过 8 词的短语并引导回文章语境查询。
- 4xx 保留输入、登录、权限、额度等真实原因；5xx、上游、配置和客户端处理异常生成错误编号，先写私有后台，再尝试发送邮件。没有成功取得错误编号时不得谎称“开发者已收到”。
- 邮件通过 `ERROR_ALERT_SMTP_*` 或 Resend 配置，15 分钟内同一错误不重复告警；邮件失败不能阻止后台记录。

非常重要的维护规则：

每次改变文章保存、文章编辑、全文翻译、解释缓存、公开推荐、URL 导入或数据结构时，都必须同步检查 `/admin` 发布、预缓存上传、公开文章打开后的缓存回放是否仍然正确。

用户已经明确要求：以后文章相关功能改动，要同步考虑 admin 网站的更新问题。

## 16. OCR 现状

OCR 需要区分“仍保留但当前主页不暴露的旧版图片导入能力”与“URL 导入文章图片自动 OCR”，不应笼统描述成全部启用或全部禁用。

现状：

- Provider 和解析逻辑在 `lib/visionOcr.ts`。
- provider 支持 Zhipu 和 OpenAI。
- `OCR_PROVIDER=zhipu` / `ZHIPU_API_KEY` 或 `OCR_PROVIDER=openai` / `OPENAI_API_KEY` 可配置。
- 首页“图片阅读”已启用；它并行调用 `/api/ocr-image` 和 `/api/ocr-image-layout`，保存原图、识别文本、词框或词框错误。
- `/api/ocr-image`、`/api/ocr-image-layout`、`/api/ocr-image-url` 均可用，单张 OCR 图片上限为 8MB。
- URL 导入文章中的图片不会在阅读器里自动触发 OCR，因为 `ReaderView` 的 OCR gate 仍关闭；已有 `ocrText` / `layoutWords` 继续兼容。
- 图片 viewer 使用鼠标滚轮缩放，并以鼠标所在位置作为缩放锚点，方便查看指针处细节；缩放必须始终保持整张图完整可见，不出现内部滚动条，也不能让后面的文章跟着滚动；不要回到需要拖动/滚动才能看完整图片的预览模型。
- 图片 viewer 会渲染已保存的 `layoutWords` 词框，点击词框可触发语境解释；没有词框时只提供原图查看。
- 远程图片下载走 `/api/download-image`，校验图片类型并限制为 20MB。

## 17. PWA 和离线

Context Reader 是有限离线，不是完整离线 AI 应用。

离线可用范围：

- 已缓存 app shell。
- 最近一次在线验证的账号会保留最小本地身份快照，并始终显示明确的“离线模式”提示；它只能开放同一浏览器里的本地内容，绝不能恢复 Admin、套餐、额度或任何服务端权限。
- 该历史账号的本地保存文章、生词本和阅读状态；可以继续保存文章、增删生词，恢复联网并重新确认会话后再同步。
- 已经缓存过的解释。
- 当前标签页已经缓存过的独立词典结果。
- 已经缓存过的全文翻译。
- 已经被该浏览器加载过的公开文章 API 响应。

离线不可用：

- 新 AI 解释。
- 新独立词典生成。
- 新全文翻译。
- URL 导入。
- 新图片 OCR。
- 摘要生成。
- 云同步、用量查询和意见反馈提交。

## 18. localStorage 和缓存观念

Context Reader 大量依赖浏览器 localStorage。游客状态下它是主要用户数据层与缓存层；登录后仍作为本地工作副本和离线/恢复层，但云端版本化对象是跨设备同步的权威来源。

耐久数据：

- 保存文章。
- 文章编辑结果。
- 词汇本。
- 解释缓存。
- 全文翻译缓存。
- 公开文章打开后写入的预缓存。
- 支持阅读连续性的文章滚动位置等状态。

临时状态：

- 搜索框内容。
- 面板滚动位置。
- 预览弹窗。
- 临时错误。
- 成功/失败 status message。
- admin 选中项。
- URL import 成功后的输入框内容。
- 解释 sheet 的临时高度。

偏好：

- 耐久数据应保留。
- 临时状态应在关闭/重新打开、切换搜索、切换解释、离开 admin flow 时积极重置。

## 19. 候选需求：词汇画像 / 查词习惯分析

用户提出过一个未来需求：通过用户查词习惯判断词汇能力。

可行性判断：

- 可以做趋势和画像。
- 不适合直接给出“你词汇量精确为 N”的强结论。
- 更适合作为动态 reading vocabulary profile。

MVP 可以记录：

- 查词事件。
- 文章难度或来源。
- 每千词查词密度。
- 被查词的频率等级。
- 重复查词。
- 查词后是否保存到词汇本。
- 查的是单词还是短语。
- 同一词在不同上下文是否反复查。

可以输出：

- 当前阅读舒适区。
- 可能的弱项。
- 词汇增长时间序列。
- 高频反复查词。
- 学术/新闻/体育/商业等主题下的理解差异。
- “相比前一统计周期更少查基础词，更多查抽象表达”这类趋势。

不要输出：

- 未经校准测试就断言精确词汇量。
- 把查词少简单等同于词汇量高，因为用户可能跳读、懒得查或文章太简单。

用户已经要求记住此需求，下次可能会让 Codex 实现。

## 20. 已知易踩坑

不要建议：

- 把文章编辑改成 textarea。
- 编辑保存时自动清掉用户想保留的空行。
- 用户只删除几段时让全文翻译整篇重来。
- 每个段落都显示“原文已修改，译文可能过期”。
- 顶部增加全文翻译按钮。
- 进入翻译侧栏后自动开始翻译。
- 让全文翻译和查词互相取消。
- 把首页图片 OCR 和 URL 导入文章图片 OCR 混为一谈。
- 忽略 admin 预缓存和公开推荐。
- 让推荐文章只靠 client mount 后 fetch。
- 把推荐文章放到右 rail 挤掉用户保存文章。
- 把首页做成营销 landing page。
- 用全局黑色顶栏。
- 用手动展开/收起掩盖词汇卡片固定行高或内容截断问题。
- 在没有校准测试时声称能精确判断用户词汇量。

## 21. 和 GPT 讨论时的使用方式

建议对 GPT 说：

```text
下面是我的 Context Reader 项目上下文。请先基于这份上下文理解项目，不要假设你能访问我的本地代码。接下来我会问你产品设计/交互/架构/提示词/需求拆解问题。你的建议必须遵守文档里的约束，尤其是文章编辑、全文翻译、admin 预缓存、Anki、OCR 现状和首页偏好。
```

适合问 GPT 的问题：

- “基于这个上下文，帮我拆一个词汇画像 MVP。”
- “这段交互哪里会让用户困惑？”
- “全文翻译更新逻辑怎么设计更清楚？”
- “admin 预缓存和本地缓存之间有哪些边界情况？”
- “帮我写一个更稳的 DeepSeek prompt。”
- “首页两个方向哪个更符合产品目标？”
- “帮我把这个功能写成 PRD。”

不适合让 GPT 直接做的事：

- 判断当前代码实际有没有 bug。
- 直接保证某个本地文件已修改。
- 直接知道 Vercel/Supabase/浏览器 localStorage 的当前状态。

这类问题应回到 Codex，让 Codex 读取本地代码、运行 build、检查缓存逻辑或部署。

## 22. 给 GPT 的默认回答风格要求

当 GPT 基于本文档回答 Context Reader 相关问题时，建议它：

- 用中文回答。
- 先给结论，再给理由。
- 明确区分“已实现”“应该保持”“可选方案”“未来需求”。
- 不要编造代码细节。
- 如果需要确认实际实现，应提示用户让 Codex 检查本地代码。
- 讨论方案时必须同步考虑 admin、缓存、公开推荐、全文翻译、文章编辑和 Anki 影响。

## 23. 账号、同步与用量系统

- 当前公开测试入口采用“中国大陆手机号标识 + 昵称注册 + 6 位数字密码”，不发短信，也不验证手机号归属。服务端把手机号映射为保留的内部 Auth 邮箱，密码由 Supabase 哈希保存；内部邮箱绝不能展示给用户。邮箱 OTP 代码只保留兼容，微信登录留到有对应主体、通道和转化证据后再做。
- 游客每天可查词 10 次，缓存命中也计入游客试用；全文翻译、摘要、OCR、保存文章、生词本与 Anki 必须登录，但管理员预发布的公开全文翻译仍对游客可见。
- 注册账号缓存命中、失败、超时和及时取消不扣额度。结构化与流式查词共用一个 action id，前台算一次，后台分别记录真实 tokens 和估算成本。
- 底层额度仍分 `guest_lookup`、`lookup_generation` 与 `deep_reading`，但 `/admin` 用中文产品含义呈现，只允许调整普通用户套餐额度。价格仍是测试假设，暂未接在线支付，也不在日常后台显示。
- 云端为准，但登录先合并本地文章、生词本和缓存。同步使用逐对象 server version，并用标准化、稳定排序的 JSON 内容比较跳过未变化对象。文章按标准化正文和旧恢复 ID 血缘合并为唯一原记录，保留最新打开时间，所有重复 ID 通过 tombstone 从云端删除，绝不生成或展示文章恢复副本；同步 API 会把旧标签页写入的 `-local-recovered-*` 文章强制转成 tombstone，云端合并完成后首页也会即时刷新文章列表和数量。生词按“单词＋原句”合并并去重，并保留可选的公开推荐文章来源；推荐文章里新增的生词记录公开 article id/title，不保存本地文章也能重新打开推荐并定位原句，旧生词首次定位时可扫描推荐库存并回填来源。多余恢复 ID 通过 tombstone 从云端删除，真正无法判断的同 ID 生词冲突只进入独立本地恢复区，不计入生词本。文章和生词删除都会同步 tombstone，避免其他设备把已删除数据恢复回来。
- 用户用量页为 `/account/usage`，数据库迁移为 `docs/account-usage-supabase.sql`，完整规则见 `docs/account-usage-plan.md`。
- 生产数据库、Vercel/Supabase 环境变量和跨设备同步已经可用。手机号 + 密码让 SMTP 不再阻塞公开测试，但手机号未验证，忘记密码只能由 `/admin` 生成一次性显示的临时密码，当前会话为 7 天。面向普通公众的邮箱登录仍未完成；若以后重新开放邮箱入口，必须先配置自定义 SMTP 与包含 `{{ .Token }}` 的模板并验证非团队邮箱。

## 24. 当前安全边界

- 所有 API 都经过统一中间层：按路由成本限流、请求体大小早拒绝、管理员同源校验、请求 ID 和安全缓存头。
- JSON 与 multipart 都按真实流式字节数限制，不能靠省略或伪造 `Content-Length` 绕过。
- URL 导入与图片代理/OCR 使用 DNS 固定连接，拒绝私网、回环、link-local、metadata 和保留地址，并逐跳复查重定向、限制远程响应大小。
- AI 与 OCR 有单实例并发闸门；流式解释、翻译和摘要在可用路径上会响应客户端断开并取消上游。
- 管理 cookie 在生产环境使用 `__Host-`、Secure、HttpOnly、SameSite=Strict，8 小时过期；`ADMIN_SESSION_SECRET` 必须独立且至少 32 字符，`ADMIN_SESSION_VERSION` 可整体撤销旧会话。
- Supabase 三张公开内容表必须启用 RLS，并撤销 `anon`、`authenticated` 和 `PUBLIC` 的直接表权限；仓库 SQL 只有在真实项目执行后才生效。
- 当前代码内置限流 Map 是单 Vercel 实例防线，不是跨实例全局配额。面向更大范围公开前，应在 Vercel WAF 或原子 Redis/KV 上增加分布式限流，并设置上游消费硬上限或告警；外部控制可能有单独价格，启用前需确认。
