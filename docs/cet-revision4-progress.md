# 第四轮实施进度

基线main：1cc616f71019952c542e6de4d22f0548fa7c742a。任务树artifacts/task-worktrees/cet-revision4，分支codex/cet-revision4。2026-09-25实时生产20260924T184912，parent20260924T041127，source f87313909b3d3d12820ec5f07af7d9d9e47a1c10，mainland_internal。共享脏根未编辑。第四轮尚未发布。

|阶段|R|状态|实现/实际证据|下一步|
|---|---|---|---|---|
|A|R06/R07|源码及数据回归完成，真实UI待验|旧版受管IndexedDB复现：删除后0，旧session迁移后1且当前时间。新增因果意图事件、可靠flush、owner会话和一次迁移；8状态回归、真实protocol-2双设备测试1、既有CET同步1通过。无清缓存/生词/用户数据|真实词典删除/关闭/重开、缓存命中及错误入口浏览器检查|
|B|R01—R03|进行中|先建路线纯函数，答卷范围保持独立|读取B指定源码|
|C|R04/R05|未开始|||
|D|R08—R10|未开始|||
|E|R11/R12|未开始|||
|F|R13|未开始|||

A修改：BookDictionary、standaloneDictionaryHistory、learningStorage、accountSyncClient；新增dictionary-history-intents/sync测试。删除意图和明确查询事件走preferences独立对象，归档随账号分区，查询必须观察全部已知删除；旧请求和旧缓存不能恢复。无owner的原session保留而不猜导入。旧历史无可靠时间的首次迁移使用2000年稳定顺序；flush后才标完成。持久化错误保留待重试提示及按钮。截图I03已读；不宣称已做真实浏览器或生产同步验收。

工程默认D01—D08按包执行；不扩题库、不改参考答案/供应商/收费。
