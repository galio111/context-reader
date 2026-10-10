# faction 美音异常：诊断与修复

## 当前状态

用户已接受对照 B：“完整、正确且自然”。已生产接受 `20261010T105000`，parent `20261010T101400`，source `5f12251e9752fb1ecf55db613e247bc702dffa4b`。公网 `/api/connectivity` 精确返回该身份及 `mainland_internal`。Amanda 美音与 0.9 合成语速保持不变；英音保持原普通词路径。

## 已确认的故障层

1. 正式网页显示 `/ˈfækʃən/`，实际请求为 `{"text":"faction","accent":"en-US"}`，没有截断拼写，也没有给这个普通词发送 IPA。浏览器取得旧文件 `cr-us-f470cc4d4224d125aceace67.mp3`。
2. 直接在服务端请求供应商，绕过应用路由、Storage、IPA 转换和网页播放器，仍返回与旧录音高度相似的异常声音结构。两次独立纯文本重新合成的短时能量包络与旧录音相关系数为 0.965、0.959；这只说明可复现性，不是自动语音转写或正确率。
3. 原录音开头直接进入周期性元音，缺少 B 中元音之前的摩擦段。显式指定 `F AE1 K SH AH0 N`、但标签内仍用 `faction`，也复现旧音频结构（相关系数 0.965）。加句号和首字母大写没有恢复与 B 相同的开头结构。
4. 相同音色、语速、音素，仅将标签内文本改为 `word`，得到用户认可的 B；再独立请求一次也重现相似结构（相关系数 0.967）。相邻拼写 `fraction` 的纯文本对照有元音前摩擦段，因此不是该音色完全无法生成 /f/。

据此可定位为**当前供应商 Amanda 对 faction 输入的合成异常**。用户描述的“像 acsection”是听感证据，不应擅自当作模型内部生成文本。供应商不暴露其文本分词、读音预测或声学生成中间结果，无法进一步证明是哪一个内部模块出错。标签内文本影响结果是实验事实；“拼写默认读音干扰指定音素”只是解释这一现象的推测。

本地代码仅解码并播放整个 MP3，`source.start()` 没有裁切偏移，未另行修改播放速率。服务器直接解码供应商的 base64 音频并存储；旧缓存使错误持续重放，但不是初次错误的来源。成功状态和可播放文件从来不能证明音素正确。

## 修复边界

共享服务把 faction 的默认美音映射到已核对的 `/ˈfækʃən/`，其对应 CMU 请求使用已接受的中性文本。普通请求和显式相同 IPA 共享新身份 `cr-us-e3342be5c9be50f4025f4448.mp3`，绕过两个旧错误身份。私有 Storage 保存**用户实际接受的 B 原文件**，SHA256 为 `b4d1be18695e88adc2177109e30ba5b4c96d3456db49b20d4e38c28a03b690d4`，不以另一段新生成音频替代。

这条服务端路径供单独查词、划词、生词本及后续 Anki 导入共用；既有 Anki 媒体不会被追溯替换。已打开页面的内存录音需要刷新后重新取得。普通同音词仍保持 Reader 原路径，没有把全部词改为强制音素合成。此前接受的 bass、lever、peg、humiliate 录音必须逐字节保持，不能借本次修复推定全词库正确。

diffuse 的 /z/、/s/ 两轮样本仍未获得用户“能区分”的确认；本次不改变它的合成方式，也不宣布它通过听感验收。

## 证据与复现

- [正式网页请求](evidence/faction-1010/faction-browser.json)、[旧文件身份](evidence/faction-1010/faction-audio.json)
- [第一轮供应商对照](evidence/faction-1010/faction-provider-metadata.json)、[重复实验参数及摘要](evidence/faction-1010/faction-root-cause-metadata.json)、[重复实验波形](evidence/faction-1010/faction-root-cause.png)
- [独立供应商复现脚本](evidence/faction-1010/faction-root-cause.mjs)：只在有服务端凭据的环境运行；输出包含 base64 音频，凭据不输出。每次运行会发生五次短词合成。
- [接受样本及身份](evidence/faction-1010/faction-approved.json)、[B 原始 MP3](evidence/faction-1010/faction-neutral.mp3)

参考：[供应商 SSML 定义](https://docs.volcengine.com/docs/DoubaoVoice/SSMLmarkuplanguage?lang=zh)。文档支持 CMU 格式，不等于当前音色的每段结果都遵守音素。实验区分了输入正确、返回成功与用户听感正确三个不同条件。

## 发布验收

44 项发音/播放器/历史专项、90 核心、九契约、供应商回退一次扣费和本地/服务器构建通过。正式普通/显式 faction 美音均返回 B 原始字节；英音及 bass、lever、peg、humiliate 和 bibliography 原音频 SHA 保持。真实页面历史回放无生成请求，新美音文件身份正确，按钮播放与键盘回放通过。签入划词/句译、词典、两段全文翻译均走 deepseek-flash，各一次1/5/10点；免费历史、会话、协议2、Admin权限、七服务与34表备份恢复通过，QA身份精确清理并保留成本审计。仅app/caddy重建，五个后端容器身份保持；当前/父版镜像保留。未新增实体手机、跨浏览器或全词库正确率结论。

[公网与核心链路](evidence/faction-1010/live-acceptance.json)、[浏览器](evidence/faction-1010/browser-final.json)、[验收摘要](evidence/faction-1010/verification.json)。
