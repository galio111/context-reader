# 单独查词发音路径与异读边界

状态：已生产接受 `20261010T101400`，parent `20261008T220600`，source `9935dd782623c0305cc7caa57c7b1ab8666beeae`。公网 `/api/connectivity` 精确返回该身份及 `mainland_internal`。普通词恢复与划词翻译相同的请求；只有同一口音的不同读法才提交对应音标。此前“所有美音都强制按 IPA 合成”的方向已被用户纠正并撤回。

## bass 当前行为

- 用户确认四段美音/英音样本“两种口音都正确、能区分”。[原样本及哈希](evidence/bass-1010/approved.json) 已保存，正式请求必须复用相同字节。
- 音乐名词（低音、贝斯）与形容词均为 /beɪs/；鱼类名词为 /bæs/。依据 [Cambridge bass](https://dictionary.cambridge.org/dictionary/english/bass)。旧历史中的贝斯错误 /bæs/ 按实际释义纠正，无需重新生成。
- 按实际异读及含义分组，不再只按词性；音乐名词与形容词合并为一组，鱼类另列。去掉“这个拼写对应多个词头，以下义项会同时保留。”提示。
- 对照实验发现 CMU phoneme 内的 bass 文本仍影响最终读音；这两个已核对读音改用中性 carrier，音素、音色与 0.9 语速不变。其余普通词、已接受录音及缓存身份不变。
- 各行播放器共享播放所有权：切换时停止前一段并废弃延迟返回的旧请求，避免叠音。
- 43 项专项、90 项核心、九项契约及一次扣费供应商回退测试通过；本地与服务器正式构建、公网音频与真实页面验收通过。

## faction 后续诊断与修复

已直接复现供应商纯文本输出异常，并保留用户接受的 B 原录音；共享服务修复待本轮正式发布验证。详见 [根因边界与复现证据](faction-pronunciation-20261010.md)。diffuse 两轮试听仍未获得可区分确认，本轮不改变其合成路径。

## 当前规则

- 按每个口音分别比较读音：只有一种读音时，发送与 Reader 一样的 `text` / `accent` 请求；同口音有多个读音时，才传当前行 `phonetic`。多个同音词性仍合并，单纯 US/UK 差异不触发音标合成。
- 预加载、点击和旧历史回放共用此规则。保留原播放器、点击意图、音色（美音 Amanda、英音 Emily）及 **0.9 语速**。没有新增词库、模型调用或运行时词典查询。
- 共享服务端保留 lever/esteem/contemplate 的核对默认值，并让 peg 和 humiliate 的普通请求复用用户已接受的参数；Reader、单独查词、生词本和 Anki 可共用这些已接受录音。显式请求不同合法音标时仍优先采用该变体。
- 仅进入音素合成的美音单音节词保留 phoneme 外句末句号；美音词尾 /ər/ 转为 `ER0`，与 /ɚ/ 共用音频身份，不合并下个音节开头的 r。英音、多音节和短语不套用单音节收尾。
- 未知或不完整音标返回 400，不调用供应商或悄悄改成另一读法。缓存身份含实际合成输入；不清空已有录音，不补生成旧历史，也不再次收费。

用户原始目标是为不同词性的异读分别标示。普通词朗读曾因全面强制音标而变差；bibliography 的中间音素即使转换无缺失，也不能保证合成听感正确。因此没有发布后续全 CMU 词库方案，而是恢复用户要求的普通词路径。讨论和旧发布经过见 `docs/product-journey.md`，不得从历史段落恢复全 US 音标合成。

## 音标与已接受音频

`lever` 美音 /ˈlevər/、/ˈliːvər/ 都有词典依据，英音 /ˈliːvə(r)/ 正确；当前默认 US /ˈlevər/、UK /ˈliːvə/。`esteem` /ɪˈstiːm/ 与美音 /əˈstim/ 都有依据，重音在第二音节，当前采用 /ɪˈstiːm/。音标记法或合法变体不同不能直接判错。其他模型生成的 IPA 仍未获得全词库词典认证。

来源：[Collins lever](https://www.collinsdictionary.com/us/dictionary/english-pronunciations/lever)、[Cambridge esteem](https://dictionary.cambridge.org/pronunciation/english/esteem)、[Collins esteem](https://www.collinsdictionary.com/us/dictionary/english/esteem)、[CMUdict](https://github.com/cmusphinx/cmudict/blob/master/cmudict.dict)、[供应商 SSML](https://docs.volcengine.com/docs/DoubaoVoice/SSMLmarkuplanguage?lang=zh)。

| 词 | 用户接受的美音 | 当前普通请求 SHA256 |
| --- | --- | --- |
| lever | 第二轮 C，Amanda，`L EH1 V ER0`，0.9 | `3aec13662a2a10d3209aa877c428b1f0ba2d28873dc78414af294e4196c8bd7f` |
| peg | 第二轮 D，Amanda，`P EH1 G` 加句末句号，0.9 | `3a3aa8321c0b11ef5629357c3f853071368dc78d2a0d7f1e65b5211ea23fa7f8` |
| humiliate | 节奏试听 B，保留 `EY2` 次重音，Amanda，0.9 | `d8a3d9f174e8dea5bbff9eb333b5edd70fc2439c1c6c5c62a09ee20d2ddc23cb` |

这些文件已逐字节验证与用户接受样本一致。bibliography 普通请求返回 `cr-us-a295588ba4407c37c5e71d8a.mp3`，SHA256 `608a9e27fad5c01c09afc6f6e00d15deaa112bd5a8ddfec0def901fee83f59c1`，与此前 Reader 普通路径一致，替代此前强制 IPA 的 `cr-us-0a770d0f6450b04e2dd6abeb.mp3`。这里只证明恢复原路径，不把网络成功视为该词已通过用户听感验收。

## 当前发布验证

- 43 项针对性测试、90 项核心回归、九项发布契约，以及独立的供应商故障回退一次扣费测试通过。覆盖同词性异义、同音合并、旧 bass 释义音标修正、晚到请求/解码不能恢复旧播放。
- 本地与服务器正式构建成功；33 文件累计增量来自干净提交，稳定部署入口核对父版本后发布，仅重建 app/caddy。五个后端容器身份未变。
- 正式接口返回四段 bass 音频与用户确认样本逐字节相同；lever、peg、humiliate 原接受录音及 bibliography 普通 Reader 音频保持原 SHA256。
- 真实浏览器旧 bass 历史回放显示“低音；贝斯” /beɪs/、“鲈鱼” /bæs/ 两组与四个按钮；无多词头提示。切换按钮最多一个处于播放状态；历史回放不调用生成接口。桌面与键盘验证见浏览器证据；未新增实体手机、跨浏览器或全词库自然度验收结论。
- 独立临时账号验证会话、协议2同步、划词/句译、词典、两段全文翻译。三项均成功走 deepseek-flash，各只有一次 1/5/10 点动作；三次历史回放不增用量。普通用户/匿名 Admin 与匿名同步/历史边界通过，临时账号和账单引用已精确清理，供应商成本审计保留。
- 七服务健康、恢复 Admin 四路 200、最新 PostgreSQL 备份 SHA 与隔离恢复34张表通过；新旧接受镜像均保留。

证据：[用户接受样本](evidence/bass-1010/approved.json)、[公网音频与核心链路](evidence/bass-1010/live-acceptance.json)、[真实浏览器](evidence/bass-1010/browser-final.json)、[正式页面](evidence/bass-1010/bass-live.png)、[回归与运维验收摘要](evidence/bass-1010/verification.json)。原始脚本和完整本地日志在 `artifacts/bass-readings-1010/`，账号秘密不进入仓库。旧发布证据保留在 `docs/evidence/pronunciation-1008/`，不替代本次验证。
