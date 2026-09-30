# 查词.pdf 修订

依据用户提供的三页 `查词.pdf`：恢复简洁排版、把播放按钮放到音标旁、同音词性不重复、只保留真实口音/词性读音差异、取消附加 the/to 的朗读，并核实 plead。

当前状态：实现和本机正式构建通过，生产发布验证中。基线为生产 `20260930T091812`，parent `20260929T232511`，source `fb1e5720f20fa574c35d9b27d2f5cc015dff4cc6`。

## 行为与依据

- 相同读音合并，单一读音组不标词性；不同读音组才列词性。冗余 other 组可并入有相同口音音标的词性组。
- 音标旁直接显示美音/英音按钮，删除“英美共用”“语境发音”和 the/to 播放前缀。等价记号归一化不删除卷舌、重音、元音、长短或 /j/ 的差别。
- [Oxford plead](https://www.oxfordlearnersdictionaries.com/definition/english/plead) 和 [Cambridge plead](https://dictionary.cambridge.org/dictionary/english/plead) 确认 plead /pliːd/；Oxford 将过去式 pled 标为 /pled/。两种当前词形分别校正，适用于原有缓存及新流式结果。
- [Cambridge hemisphere](https://dictionary.cambridge.org/us/pronunciation/english/hemisphere) 的 UK/US 转写确有差异，因此不根据“听起来接近”粗暴合并真实口音差异。
- 单词音标通过服务器受限校验后进入 provider `phoneme` SSML，播放只包含查询单词；缓存按音标隔离。实测 Emily 音色接受 plead、record 名词和动词 IPA 请求并返回非空 MP3。成功响应不等于已经听验全部音素。

## 验证

- 发布保护契约、本机正式生产构建和类型检查通过；构建保留既有无关 lint warnings。
- 分组、当前词形、流式/缓存、SSML 边界、音频缓存与历史/同步专项 24 项通过。
- 实际生产渲染函数与真实播放按钮事件测试 1 项通过：相同读音不显示词性，按钮请求只含单词、对应口音与音标；指定音标失败不调用本地朗读；record 动词按钮发送动词 IPA。
- 核心回归 89 项通过。
- Chrome 本机正式构建：固定接口测试数据验证 plead 单组、hemisphere 去重/双口音、record 异音分组；实际 DOM 中按钮距音标 10px。390×844 窄屏文档宽度 390px，各行位于 29–361px，无横向溢出。点击 plead 美音走真实 provider 并产生成功日志。本机游客额度不足，布局样例明确使用临时网络拦截；已清除拦截和视口覆盖。真实生产查词、日夜浏览器结果及最终生产身份在发布后更新。

## 开放项

模型生成的任意词音标无法靠格式校验获得词典级正确性证明。保留不确定时不编造音标的生成规则；本轮校正的词形有上述词典依据。用户最终听感、物理手机、Edge 和全词表语音正确性仍待验证。
