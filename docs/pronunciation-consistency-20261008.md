# 单独查词发音路径与异读边界

状态：已生产接受 `20261008T171800`，parent `20261008T164800`，source `36c28db24447ed9ce15720343bb150eefd581418`。通用美音音标绑定、词尾卷舌转换和全部单音节音素请求的句末收尾均已上线。公网版本、10词音频身份、已接受样本、真实浏览器及账户回归通过；自然度听音接受覆盖 lever 与 peg，未声称全词库准确。

## 确认的事实

核对聊天“优化单独查词发音与历史缓存”（01a106ff-2924-7201-8def-f22174a0c134）和修复前生产 `20261006T122200`（parent `20261006T121000`，source `b2f55edd29877c228de598896f6b80a9e961edc9`）：普通词的显示 IPA 未传入音频请求；上一轮预加载/点击意图/历史回放修复没有证明词汇发音正确。美音 Amanda、英音 Emily 和 0.9 合成语速均未发生此次调整前的配置漂移。

`lever` 美音 /ˈlevər/ 和 /ˈliːvər/ 均有依据；英音 /ˈliːvə(r)/ 正确。`esteem` /ɪˈstiːm/ 与美音 /əˈstim/ 均有依据，重音在第二音节。不能因为与另一词典不同就把合法变体标成错误。当前学习界面采用 lever US /ˈlevər/、UK /ˈliːvə/，esteem /ɪˈstiːm/ 作为核对后的默认值。其他词的 IPA 仍可能由模型生成，当前实现不等于全库词典认证。

来源：[Collins lever](https://www.collinsdictionary.com/us/dictionary/english-pronunciations/lever)、[Cambridge esteem](https://dictionary.cambridge.org/pronunciation/english/esteem)、[Collins esteem](https://www.collinsdictionary.com/us/dictionary/english/esteem)、[CMUdict](https://github.com/cmusphinx/cmudict/blob/master/cmudict.dict)、[供应商 SSML](https://docs.volcengine.com/docs/DoubaoVoice/SSMLmarkuplanguage?lang=zh)。CMUdict lever 对应 `L EH1 V ER0`，长元音变体对应 `L IY1 V ER0`。

## 听音结果与选择

第一轮保留音色/语速、直接传入原转换音素的 B：用户反馈 lever 美音仍错、英音更对但生硬、esteem 两口音听不出差异，随后明确“主要是美音的问题”。该轮未上线。

第二轮：C（Amanda，CMU `L EH1 V ER0`，0.9）“读对且自然”；D（Amanda 直接 IPA）仍错；E（Jackson）仍错；F（Lauren）读对但生硬。采用 C，保留当前两种音色和原语速。D/E/F 未进入生产。

## 实现边界

- 当前修订：同一口音内读音一致时，查词与划词翻译发送相同的普通词请求；只有同一口音确有不同读音时才发送对应音标。英美口音本身不同不算词性异读。预加载、点击与旧历史共享这一选择规则，词性仅在真实读音不同时分开。
- 美音单音节音素请求按 CMU 元音数识别，统一在 phoneme 外添加句末句号；无需按单词拼写配置。多音节、短语和英音保留原收尾。
- 美音词尾 /ər/ 转为 CMU `ER0`，与 /ɚ/ 共用同一正确音频身份；不把下一个音节开头的 r 合并，也不改变英音音素。
- lever/esteem 核对值作用于旧缓存和新结果，不补生成历史、不再次收费；US 默认请求也用同一核对值。显式请求合法变体时，不被默认覆盖。
- `(r)` 仅按口音处理词尾可选标记；其他未知/不完整音标在 API 端拒绝，不调用供应商或退回另一读法。
- 不清理已有录音库。缓存键按实际合成输入变化，正确音频与旧音频分离。

## 验证

两次发布均通过90项critical、九项发布契约及本地/服务器正式构建；首版37项发音/真实控件/历史/供应商回退与一次计费专项通过，最终单音节修订23项发音/控件/缓存/API专项通过。第一版164800为33文件累计增量，最终171800为其上的31文件累计增量；稳定部署入口锁与父版本复核启用，只重建app/caddy。

公网 `/api/connectivity` 精确返回上述 release/parent 和 `mainland_internal`。默认 lever US、显式 /ˈlevər/、等价 /ˈlɛvɚ/ 均返回与用户接受 C 完全相同的 34,560 字节 MP3，SHA256 `3aec13662a2a10d3209aa877c428b1f0ba2d28873dc78414af294e4196c8bd7f`；该已接受样本写入其新的内容身份并读回核验，不清理其他缓存。peg US /peɡ/ 返回用户接受D的30,240字节MP3，SHA256 `3a3aa8321c0b11ef5629357c3f853071368dc78d2a0d7f1e65b5211ea23fa7f8`。10词线上抽测的文件身份均对应通用句末收尾输入（见coverage-live.json），不只peg命中特殊文件。UK 文件与修复前逐字节相同；显式长元音变体保留独立身份，不被短元音默认覆盖；未知音标返回 400。

真实线上浏览器显示lever/esteem/peg核对音标，美音预加载分别传 /ˈlevər/、/ɪˈstiːm/、/peɡ/，英音沿用原选择策略。最终刷新后peg预加载返回已接受D的文件身份，键盘Enter触发播放；390px/减少动态效果模式下控件可操作，切历史lever再回peg零生成请求且无控制台错误，桌面截图已存。独立临时 QA 账号验证会话/协议2同步、单词与句译/查词/全文翻译均走成功的 `deepseek-flash`，三项分别只记一次 1/5/10 点；完整查词结果连续三次历史回放用量不变。普通用户与匿名 Admin 边界、匿名同步/历史边界通过。临时账号及其账单引用已精准清理，供应商成本审计保留。

七服务健康、恢复 Admin 四路 200、最新备份 SHA 与隔离恢复 34 表通过。五个后端服务容器身份及创建时间未变，启动时间均早于本次发布；当前/父版接受镜像齐全。最终证据见 [live-acceptance-final.json](evidence/pronunciation-1008/live-acceptance-final.json)、[browser-final.json](evidence/pronunciation-1008/browser-final.json)、[coverage-live.json](evidence/pronunciation-1008/coverage-live.json)。

## peg 补充问题

用户在本轮发布验证期间报告“peg 的重音也奇怪”。[Cambridge](https://dictionary.cambridge.org/us/pronunciation/english/peg) 标 /peɡ/，[Collins](https://www.collinsdictionary.com/dictionary/english-pronunciations/peg) 美音标 /pɛɡ/，都属于该单音节词的合法标法；不标重音符号不意味着弱读。实测当前转换器将 /peɡ/、/pɛɡ/、/ˈpeɡ/ 全部转换为 `P EH1 G`，没有漏标主重音的证据。

第一轮同一 Amanda 的三组本地对照：A 旧的纯文本“仍然奇怪”、B 当前按音标且0.9语速“读对但生硬”、C 同音素且1.0语速“仍然奇怪”。用户进一步指出最后 g 的音奇怪，三者均未获自然度接受，不把 B 标为成功。生产语速未变。

第二轮保留 `P EH1 G` 和0.9语速：D Amanda 只增加句末句号、F Jackson 获用户“读对且自然”接受，E Lauren 仍奇怪。选择 D 保留原音色。用户强调不能只改一个词，故按 CMU 元音数识别所有美音单音节音素请求，在 phoneme 外添加句号，不增加 peg 专用分支；多音节、短语和英音维持现有路径。10词规则回归覆盖 peg/bag/leg/big/dog/egg/cat/book/change/stay；缓存依据合成输入自动分开，不复用旧尾音。其他词自然度仍不由自动测试推断。

用户听音确认覆盖第二轮 C 的 lever 美音和第二轮 D 的 peg 美音。其他词的音质、全词库正确性、实体设备及跨浏览器仍需独立验证，不由 HTTP 200 或自动测试推断。

本机原始对照及反馈：`artifacts/pronunciation-consistency-1008/`。该目录仅存本轮音频/脚本/证据；账号秘密不进入仓库。

## 当前决定：普通词恢复划词翻译路径（待本轮生产验收）

用户指出划词翻译朗读正常，最初只要求为不同词性的不同读法分别标示；全体普通词强制音标合成扩大了需求范围。用户报告 bibliography 中间音听似丢失，真实线上 US /ˌbɪbliˈɑɡrəfi/ 转换为 B IH2 B L IY0 AA1 G R AH0 F IY0，与词典音素相符，因此不能靠补重音证明解决。humiliate 次重音 B/D 获听音接受只证明该样本，不构成全面启用音标合成的理由。

最终修订只改查词请求选择：每个口音分别比较真实读音数量；唯一读音走与 Reader 相同的 word/accent 请求，多读音才传当前行IPA。US/UK读音差异、多个同音词性均不触发IPA。音色、0.9语速、预加载/播放意图、缓存与历史免费回放保持原样；共享服务端保留lever/esteem/contemplate默认纠正，并将用户已接受的peg D与humiliate B参数用于不带IPA的请求，让Reader、查词、生词本和Anki共用已接受录音，显式变体仍优先。未发布的全CMU词库方案已撤下，没有词库新增依赖或运行时开销。此前全体美音行强制IPA的方向已被此决定取代。

回归需验证 bibliography/humiliate/lever/peg 普通请求、regiment多词性同音合并、record异读、alternate仅UK异读时US仍普通请求，以及真实线上历史/预加载/点击。此次验收首先证明恢复原有路径，不宣称所有TTS录音经过人工听验。
