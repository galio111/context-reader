# K01—K18 保留验收（进行中）

候选源码：82c1376；Windows Chrome，本地正式构建；Edge 尚未接入，手机真机按用户指示暂缓。partial 不算通过，源码无差异也不单独当作交互证据。测试日志在本目录 test-logs 下。

| 项目 | 当前结论 | 已有证据 | 尚缺内容 |
|---|---|---|---|
| K01 品牌球体 | partial | ballpit-first-frame 实际场景生命周期测试；保留原数量、碰撞和CSS；N1真实开屏到展示滚动 | 全组前后关键帧、延迟模块/后台恢复真实浏览器 |
| K02 照片动效 | partial | cover-preview-motion 真实组件指针/同一surface；Reader进入39帧、返回80帧；e-tail-n1-summary.json | 四角悬停/全部入退场对照、Edge |
| K03 图片内容 | partial | c-backfill-summary.json、c-pilot-verification.json；700张仅增加等比变体，702条数据逐行对照保留原字段及时间 | 所有变体逐图视觉不声称已完成 |
| K04 推荐规则 | partial | 89核心回归含白名单/分类/今日/偏好；e-category-ui.json 实际四类各10张；7加载回归 | 会员登录前后稳定性、真实偏好排名样例 |
| K05 入口列表 | partial | 实际外刊Reader和按题型CET入口；完整目录IDs保留；loader到末项回归 | 真实会员全库搜索/连续浏览 |
| K06 展示区 | partial | 6媒体测试；e-tail-n1-summary.json 自动播放；手动暂停返回实测；高清原视频哈希/尺寸 | Edge、全部模块切换真实录像 |
| K07 阅读交互 | partial | ReaderView未改；89核心回归含长文token、图像缩放、源定位、移动侧窗 | 跨行/反向短语选择实测 |
| K08 翻译AI | partial | e-translation-awaits-action.png 明确点击才启动；模型/计费/取消集成回归 | 真实查词、生成和取消端到端；本地无账号/AI服务 |
| K09 保存位置 | partial | e-reader-entry-final.png / e-reader-return-final.png，返回同scrollY=2354；原存储/编辑/保存回归 | 真实保存/撤销/重做组合 |
| K10 词典生词 | partial | 67 CET回归含真实IndexedDB、protocol-2删除/重查/旧端重放；89核心含Anki稳定ID | 真实浏览器历史删除/重查/发音/Anki |
| K11 目标记录 | partial | 单篇匹配/填空实际独立活动；匹配提交固定累计用时；67 CET覆盖旧版与不可变快照 | e-selftest-expiry-observation.txt 实际60秒到时固定；跨端仍待 |
| K12 同题型路线 | partial | 67 CET回归轨迹/跨试卷/固定scope；匹配与填空实际1/6路线 | 多已访问题组浏览器往返快照比对 |
| K13 题目侧窗 | partial | e-matching-shared-answer.txt：正文/侧窗同步A段；e-cloze-practice-dom.txt 无题窗/展开入口；e-single-submit-dock.png | 选词时收起恢复和完整半圆动效录像 |
| K14 自测控制 | partial | e-selftest-paused.txt / png 实际暂停遮题；自测工具禁用；组件事件回归 | e-selftest-expiry-observation.txt 已观察到时工具恢复；完整收放动效待 |
| K15 计时提交 | partial | e-matching-timer-reset.txt 实际归零保留答案/暂停；e-matching-submitted.txt 固定累计38秒；67 CET跨端epoch测试 | 真实右键设置及刷新终态 |
| K16 权限同步 | partial | 67 CET / 20集成覆盖A/B隔离、认领、CAS/游标/tombstone/晚到数据 | 真实登录/离线/跨账号浏览器；现已连接账号后端且用户登录；原页登录展开缺陷修复042c0ea，跨账号待 |
| K17 主题访问性 | partial | DPR1/3真实尺寸检查；89核心回归移动工具/主题命中区域 | Chrome日夜/键盘完整路径、Edge；手机暂缓 |
| K18 运维更新 | partial | 大陆connectivity及current再次实查；发布契约和egress测试；变体发布接入及可恢复backfill | 实际新封面发布、稳定发布入口最终检查、生产切换及回归 |

目前不能宣称 K01—K18 全部无退化。阶段 F 尚未执行，应用没有部署。生产只有可回滚的封面变体数据增补，原图和原内容保留。
