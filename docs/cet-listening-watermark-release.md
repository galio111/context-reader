# 听力水印与页脚修复

已生产：`20261002T202624`，parent `20261002T201050`，source `205c32b7a5d17c51c0126bfbffca9b58b21fb3fc`；2026-10-02 12:30:26 UTC接受。公网release/parent与mainland_internal、current/state/manifest一致。首批15处修复为 `20261002T201050`（parent `20261002T190651`，source `26a8aa574e34e03d3f4f753562c3eaa09dae6205`）；真实提交后的复查补齐第7/16/24题的3处变形水印，形成最终18处修复。

8套听力共18处来源污染定点修复：8个选项、10个解析。2025年6月六级第1套第1题C现在为“Call the man's company.”，答案C保留。2021年12月四级第1套第19题B按原PDF把3O恢复30；同一选项的试卷页脚移除。六级2025年6月第16题补回原卷句末句号，移除水印残片。

其余清理包括2020年12月四级第2套、2023年6月四级第1/2/3套、2023年6月六级第1套、2022年12月六级第2套。四级2023年6月第3套原卷明确共用前两套听力；现有第2套共用对应关系保留，其污染依据第2套原PDF核对。

[逐处修正证明](evidence/cet-listening-watermark/cleanup-proof.json)包含原文、修正后文字、原PDF固定commit链接/文件SHA/页码，以及题库文件修正前后SHA。逐个把更改反向替换后，字节SHA必须恢复原样；原19套历史基准哈希未改写。本次其中6套有明确修正，其余13套仍逐字节相同。答案、题序、录音、原文组和已提交历史快照保持不变。旧快照保留原始作答版本，新练习使用修正题库。

新增 `scripts/audit-cet-listening-content.mjs` 只读巡检全部62套、1550题、6200个选项和465组原文；英语表面的中文、来源痕迹、页脚提示人工复核，中文解析只识别明确来源污染。程序不自动删中文、不推断题意，不往页面增加加载或渲染开销。

本地验证：90项CET、89项核心、8项跨提供商/计费回归，9项发布合约、公共数据出站约束及生产构建通过。构建保留既有lint提示，CET组件测试保留既有React act提示；无失败或跳过。

正式验收：实际首页→对应卷→新练习→C作答→提交本篇（24题未答提示）→判正确，逐题完整原文仍为7组。全页真实DOM确认无整段或变形水印，第24题中文选项恢复“C)它被波士顿上流社会所采纳。”；选项company实际查词得到语境含义及整句翻译。393×852模拟宽度无横向溢出，恢复默认桌面宽度后截图留档；当前页控制台无错误。不以API或mock Reader替代这些检查。旧提交在新练习入口仍保留，未清浏览器缓存或历史。

[真实Reader与截图](evidence/cet-listening-watermark/public-reader-evidence.json)、[干净选项与查词截图](evidence/cet-listening-watermark/public-final-submission.jpg)、[解析截图](evidence/cet-listening-watermark/public-final-clean-explanation.jpg)、[移动宽度截图](evidence/cet-listening-watermark/public-final-mobile.jpg)、[公网全库检查](evidence/cet-listening-watermark/public-listening-smoke.json)均对应最终生产版本。149卷目录保持轻量，62套1550题465组原文及61份原始录音Range/MIME/immutable通过，所有18处当前API字段与修正证明逐一相同。播放前src仍为空，本次巡检脚本不进入页面加载路径。

[签入核心](evidence/cet-listening-watermark/live-core.json)三项完整成功；[提供商/计费账本](evidence/cet-listening-watermark/core-ledger.json)证实DeepSeek Flash、每项一笔成功执行及一次计费，Admin恢复会话/读取成功，匿名边界维持401/403。[两端实际协议2同步](evidence/cet-listening-watermark/client-sync.json)保留播放位置、原文提交快照、旧30题范围、旧v2活动和文章，不产生删除墓碑。

[运行与发布证据](evidence/cet-listening-watermark/production-operations.json)：最终14文件真实delta，source为干净提交，stable发布锁/parent复核/9合约保留，仅重建app/caddy；七服务健康，最新备份SHA校验及隔离恢复17张public表通过，当前镜像eb2184b4025f、父镜像0ed7705d71f9留存。首批证据单独留在initial-release-operations.json与initial-public-smoke.json，不与最终版本混淆。

人工逐字校对全部听力与物理设备验收仍未完成，本次定点PDF核对不等于全库人工认证。
