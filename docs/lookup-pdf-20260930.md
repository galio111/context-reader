# 查词.pdf 修订

依据用户提供的三页 `查词.pdf`：恢复简洁排版、把播放按钮放到音标旁、同音词性不重复、只保留真实口音/词性读音差异、取消附加 the/to 的朗读，并核实 plead。

当前状态：已生产部署，听感与完整设备视觉验收仍开放。接受版本 `20260930T113229`，parent `20260930T091812`，source `101d6df3d120bb9f3e365da3dc6f1cf5ede90f0b`；公网 `/api/connectivity`、服务器 state 与 current 精确一致。发布基线 source 为 `fb1e5720f20fa574c35d9b27d2f5cc015dff4cc6`。

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
- Chrome 本机正式构建：固定接口测试数据验证 plead 单组、hemisphere 去重/双口音、record 异音分组；实际 DOM 中按钮距音标 10px。390×844 窄屏文档宽度 390px，各行位于 29–361px，无横向溢出。点击 plead 美音走真实 provider 并产生成功日志。本机游客额度不足，布局样例明确使用临时网络拦截；已清除拦截和视口覆盖。生产真实词条及最终身份见下方生产验收；夜间复查仍开放。

## 开放项

模型生成的任意词音标无法靠格式校验获得词典级正确性证明。保留不确定时不编造音标的生成规则；本轮校正的词形有上述词典依据。用户最终听感、物理手机、Edge、夜间模式浏览器复查和全词表语音正确性仍待验证。最后一轮浏览器控制连接返回 Debugger unattached，因此未补做夜间复查。

## 生产验收

- 固定服务器发布入口通过保护契约和正式构建，审查 19 文件增量，仅重建 app/caddy。
- 生产 Chrome 真实缓存词条 plead、hemisphere、stewardess 的发音布局已检查，截图保存于 `artifacts/lookup-pdf-release/production-plead.png` 与 `production-hemisphere.png`。本机临时固定数据检查和生产真实词条检查分别记录，不混同。
- plead 美音与英音真实播放请求均只发送 plead 和 /pliːd/，返回 HTTP 200 非空音频，分别 32640 与 28320 字节；GB 按钮实际进入播放状态。API 成功不能代替听感验收。
- 恢复 Admin 的会话、账号、公开文章和自动化检查均 200；匿名同步/Admin 均 401，公开首页及会话正常；七服务健康通过。
- 最新备份 `context-reader-20260929T191551Z.dump` 校验和及隔离恢复通过，恢复 17 张 public 表；当前与父版本回滚镜像存在，未实际执行回滚。
- 本机窄屏 390px 无横向溢出；生产物理手机、完整夜间和 Edge 复查仍开放。保留已有图片和动效行为。

上线时间：2026-09-30 11:36（北京时间）。实现提交为上述 source；后续文档验收提交不改变运行时身份。
