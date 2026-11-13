# Chrome 网页划词助手

入口：`/browser-extension`，首页 Menu 的“浏览器扩展”。支持 Windows 和 macOS 桌面 Chrome；Mac 真机体验仍需实际确认。

## 使用

网站下载 ZIP，解压后在 `chrome://extensions` 开启开发者模式并加载包含 `manifest.json` 的文件夹。下载不会静默安装；正式商店上架尚未办理。安装前打开的网页需刷新。

在网站扩展页选择本浏览器已登录账号并点击“连接所选账号”。该选择只决定扩展查询/生词的归属，不切换网站当前账号。以后切换网站账号不会改变扩展目标；要更改目标，重新连接所选账号。网站可解除指定连接。连接 90 天有效，退出网站不会自动解除这个独立连接。

默认选词后按 `Alt+Shift+D` 查询，也支持选中文字的右键菜单。扩展图标打开设置，通过 Chrome 的快捷键页自行修改组合键。可开启划词自动查询。

浮窗可拖动标题栏移动，拖右下角改变大小；设置页可输入宽高，调整背景不透明度、背景色、文字色和强调色，实时预览并自动保存。透明度只影响背景，文字不随背景变淡。关闭/Esc 取消当前浮窗；再次划词创建新窗口。

## 上下文与结果

- 从真实 DOM Range 定位所选词的具体出现位置，保留 inline 文本，复用网站 tokenizer 的句界规则，并保留 `Fig. S19` 等跨行图号。
- 只采集所选块的当前句和相邻句。跳过输入框、可编辑区、script/style 和隐藏内容；不能取得完整句时改用独立词典。
- 语境模式直接打包复用 `ExplanationPanel` 与 `PronunciationButtons`，并行请求现有结构化与流式路由。完整流式文本为可见权威，合并后再启用保存；不完整流保留显示并要求重试。
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

## 验证状态

本地 17 项聚焦测试、10 项账号/生词相关回归、发布契约和 Next 构建通过。隔离的实际 Windows Chrome 已验证：重复词准确定位、共享面板流式结果与结构化结果合并、保存可见内容、外观持久化与即时更新、拖动和右下角缩放、快捷键注册、Esc 关闭、词典降级、切换连接拒绝旧窗口保存，以及严格 CSP 网页中的浮窗。无头浏览器的合成按键不能触发 Chrome 原生扩展快捷键；实体键盘触发仍需用户实际确认。

这些浏览器交互使用合成模型响应，不等于真实线上账号/模型验收。生产身份、数据库往返和发布结果见本次交付证据；Mac 真机、任意第三方站点兼容和用户视觉接受仍开放。
