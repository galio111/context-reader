# 2026-10-01 独立查词发音与游客悬停菜单修复

状态：已生产部署，听感及全词表验收开放。接受 `20261001T101112`，parent `20260930T120723`，source `0cd406d09026ba36a3a75e1434e7279f06e0f1e0`，接受时间 `2026-10-01T02:17:44.615234+00:00`。公网 `/api/connectivity`、服务器 current/state 与 mainland_internal 精确一致。111 项自动回归、本机/服务器正式构建、类型检查和九项保护契约通过；本机与生产浏览器游客悬停经过顶部及按钮间空隙后，快捷栏仍保持展开，单独查词可点击打开。基于接受生产 `20260930T120723`，parent `20260930T113229`，source `4eb1f036e1d508268e5dbbce760c8a4b56d892e9` 的独立工作区，稳定入口核对 19 文件精确增量，仅重建 app/caddy。上轮未进入该源码的查词验收文档提交 `5d31ad0` 已显式 cherry-pick，未覆盖共享脏根目录。

用户报告大量词读音和重音错误，点名 burglary、tertiary、alternate；同时报告游客悬停 Menu 后无法点击展开按钮。

## 原因和修复

- 上轮使用 `phoneme alphabet="ipa"`，但[提供商英文音标文档](https://docs.volcengine.com/docs/DoubaoVoice/SSMLmarkuplanguage?lang=zh)列出的是 CMU。旧路径可返回 HTTP 200/code 3000 与非空音频，不能据此认定实际读音正确。当前音色控制实验把 hello 的 CMU 指定为 K AE1 T，无词提示 ASR 实际转写为 cat，说明支持的音素格式确实执行。
- 普通单词恢复英文音色自身的词汇读法，不再把模型生成的 IPA 强制写进每个单词的朗读；真正的异词性读音组才指定音素。服务器把可完整映射的 IPA 转为 CMU，保留主/次重音；未知音素、缺少多音节重音、过长 SSML 都回到纯查询词，不丢掉部分音素、不编造重音、不加 the/to。
- 指定读音缓存切到 `cmu-ssml-v2`，身份包含实际合成输入，绕过旧 `ipa-ssml-v1` 音频；普通文字缓存保持连续性。同一字母词的不同读音仍隔离，相同合成输入可复用。所有独立查词云端失败都明确报错，不切换到可能换口音的本地语音。
- 按 [Cambridge burglary](https://dictionary.cambridge.org/pronunciation/english/burglary)、[tertiary](https://dictionary.cambridge.org/pronunciation/english/tertiary)、[alternate](https://dictionary.cambridge.org/us/pronunciation/english/alternate) 核实三个词的缓存与新结果音标。alternate 保留动词 /eɪt/、名词/形容词 /ət/ 以及英音词性重音差异。
- 游客快捷栏展开态 nav 恢复事件命中，品牌到首按钮和按钮之间的空隙不再令 :hover 消失。收起态不命中、外刊图片与全部动效保持。

## 已完成验证

- 111 项核心、发音、分组、真实按钮事件、词形与历史同步回归通过。首次核心测试因未加载仓库 server-only 测试上下文而失败；使用现有 `scripts/test-server-context.mjs` 后全部通过，未修改产品依赖或跳过测试。
- 旧方式 tertiary 英音在无词提示 ASR 中被识别为 Tasha，burglary 英音为 burglar；正常单词朗读均识别为目标词。最终策略 26 份双口音音频实测均返回非空 MP3，其中 25 份无词提示转写为目标词，stewardess 英音识别为 Stuartis。该异常保留为需要人工听验的样本，不能把识别模型当作每个音素或重音正确的证明。
- CMU 转换的单元测试覆盖主/次重音、卷舌、长元音、双元音、塞擦音、边界和 alternate 六个词性/口音组合；指定读音缓存测试证明不复用旧 IPA 文件。
- 修复版正式构建接口的六组双口音请求：首次完整收到音频 713–879 ms，再次服务端热缓存 5–10 ms。本机后端未连接存储，首次显示 unavailable、重复显示 hit；因此该数据测量新合成与进程热缓存，不能当作公网端到端播放速度。转换在本地代码内完成，产品未添加任何 AI/ASR 往返。
- 公网六组双口音接口完整收音频：burglary/alternate 四组新合成 miss 为 751–878 ms；已存储的 tertiary 首次请求即 hit，为 77–104 ms；六组再次请求 hit 为 61–251 ms。浏览器相同读音再次播放还复用页面内存，不新增网络请求；解码与设备输出时间未计入接口数据。
- 生产真实游客完成 burglary、tertiary、alternate 三次查询；前两个词的四个播放请求仅有 text/accent，alternate 三词性六个按钮使用各自核实的音标。美音名词/形容词相同读音复用页面缓存，因此共九个实际请求，全部 200 与非空音频，文件名按实际读音隔离。burglary 重复美音点击无新增请求，播放状态正常；浏览器 console error 为空。截图和接口计时保存在共享根的 `artifacts/pronunciation-1001-evidence/`，不包含在生产包内。
- 公网首页与匿名 session 为 200，匿名 account/sync 和 Admin public-articles 为 401；恢复 Admin session/accounts/public-articles/recommendation-automation 全部 200。七服务健康，最新 `context-reader-20260930T192131Z.dump` SHA 校验及隔离恢复 17 张 public 表通过；当前/直接父接受镜像均存在，核心五服务持续运行数周，未重建或重启。未实际执行生产回滚。

## 验收边界

本模型无法直接听取音频；使用实际音频、无词提示转写和音素请求检查增强验证，但不能替代用户听感或专业语音评估。普通词模型的所有重音与全部异形同音词覆盖不保证；模型生成的未审核 IPA 仍有数据质量边界。真实 alternate 词条的 AI 正文说明泛称形容词首音节重音，未说明英音第二音节，与已核实的分口音音标存在文案差异；本轮修复播放链路与音标，未宣称生成词条全文语音说明已全部审核。物理手机、Edge 和全词表人工听验未完成。

最终文档额外显式 merge 远程 `20af81a` 的上一轮 CET 发布记录，保留其完整历史。本轮实现 sourceRevision 始终是 `0cd406d09026ba36a3a75e1434e7279f06e0f1e0`，后续仅文档同步不再次部署；默认 main 采用正常非强制推送并核对远端 SHA。
