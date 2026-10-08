# 单独查词美音与音标一致性

状态：修订已实现，C 样本获用户“读对且自然”的听音确认；正在进行生产发布验证，尚未宣称上线。

## 确认的事实

核对聊天“优化单独查词发音与历史缓存”（01a106ff-2924-7201-8def-f22174a0c134）和当前生产 `20261006T122200`（parent `20261006T121000`，source `b2f55edd29877c228de598896f6b80a9e961edc9`）：普通词的显示 IPA 未传入音频请求；上一轮预加载/点击意图/历史回放修复没有证明词汇发音正确。美音 Amanda、英音 Emily 和 0.9 合成语速均未发生此次调整前的配置漂移。

`lever` 美音 /ˈlevər/ 和 /ˈliːvər/ 均有依据；英音 /ˈliːvə(r)/ 正确。`esteem` /ɪˈstiːm/ 与美音 /əˈstim/ 均有依据，重音在第二音节。不能因为与另一词典不同就把合法变体标成错误。当前学习界面采用 lever US /ˈlevər/、UK /ˈliːvə/，esteem /ɪˈstiːm/ 作为核对后的默认值。其他词的 IPA 仍可能由模型生成，当前实现不等于全库词典认证。

来源：[Collins lever](https://www.collinsdictionary.com/us/dictionary/english-pronunciations/lever)、[Cambridge esteem](https://dictionary.cambridge.org/pronunciation/english/esteem)、[Collins esteem](https://www.collinsdictionary.com/us/dictionary/english/esteem)、[CMUdict](https://github.com/cmusphinx/cmudict/blob/master/cmudict.dict)、[供应商 SSML](https://docs.volcengine.com/docs/DoubaoVoice/SSMLmarkuplanguage?lang=zh)。CMUdict lever 对应 `L EH1 V ER0`，长元音变体对应 `L IY1 V ER0`。

## 听音结果与选择

第一轮保留音色/语速、直接传入原转换音素的 B：用户反馈 lever 美音仍错、英音更对但生硬、esteem 两口音听不出差异，随后明确“主要是美音的问题”。该轮未上线。

第二轮：C（Amanda，CMU `L EH1 V ER0`，0.9）“读对且自然”；D（Amanda 直接 IPA）仍错；E（Jackson）仍错；F（Lauren）读对但生硬。采用 C，保留当前两种音色和原语速。D/E/F 未进入生产。

## 实现边界

- 美音行始终传入该行音标，预加载与点击共享音频；词性仅在真实读音不同时分开。英音维持现有播放选择策略。
- 美音词尾 /ər/ 转为 CMU `ER0`，与 /ɚ/ 共用同一正确音频身份；不把下一个音节开头的 r 合并，也不改变英音音素。
- lever/esteem 核对值作用于旧缓存和新结果，不补生成历史、不再次收费；US 默认请求也用同一核对值。显式请求合法变体时，不被默认覆盖。
- `(r)` 仅按口音处理词尾可选标记；其他未知/不完整音标在 API 端拒绝，不调用供应商或退回另一读法。
- 不清理已有录音库。缓存键按实际合成输入变化，正确音频与旧音频分离。

## 验证

90 项 critical、37 项发音/真实控件/历史/供应商回退与一次计费测试、九项发布契约通过。正式生产构建通过；生产证据将在接受后补齐。

用户听音确认仅覆盖 C 的 lever 美音。其他词的音质、全词库正确性、实体设备及跨浏览器仍需独立验证，不由 HTTP 200 或自动测试推断。

本机原始对照及反馈：`artifacts/pronunciation-consistency-1008/`。该目录仅存本轮音频/脚本/证据；账号秘密不进入仓库。
