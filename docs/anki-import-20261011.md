# galio 学习进度迁移

状态：2026-10-11 已写入正式大陆数据库，并完成逐条读取校验。本次为账号数据迁移，没有修改线上应用、表结构、算法或发布版本。线上仍为 `20261010T223500`，parent `20261010T153500`，source `6a0829e0b454beec9d2e8795e5700c41d4393803`。

## 导入结果

用户提供 `long term run.apkg`，SHA256 `ae4a8d716d5979961bff0334d0dc0a31cbe1c5d4bc4c3385081ae51cf7dbea12`。包包含现代 zstd 压缩的 `collection.anki21b`，965 个词条、965 张卡、6,345 条历史作答。908 张处于 Review，57 张未学；没有暂停、过滤牌组或待处理学习步骤。

全部匹配现有生词：161 个使用 ContextReaderId，729 个使用已有 note ID，75 个使用创建时间和规范化单词的唯一组合。没有仅凭相似拼写猜测，没有新增或删除词条。部分 Anki note ID 曾变化，所以不能只按 note ID 交集迁移。

迁移后共有 1,166 个可参加站内学习的词：908 个从 Anki 继续复习，255 个未学，3 个原有站内巩固词。原有 201 张站内卡和全部 7 条站内作答保持原样；历史事件总数 6,352，其中 1 条原有撤销记录仍保持撤销，统计读取 6,351 条有效作答。

导入时 Anki 已到期 535 词。当天已有 3 个站内复习目标，本次只补足 97 个旧词，总复习目标仍为 100；57 个真正未学词在现有 flexible-start 流程中加入新词队列。仍然先复习再学新词，未到期词不会提前塞入计划。没有补发额度、会员或连续学习天数。

## 记忆与历史边界

- 当前 FSRS stability、difficulty、最后复习时间、interval、reps、lapses 直接保留源值，不从零重算。日期以源 collection 的北京时间创建日加 due 日数还原，再落在站内北京时间零点；保留到期日，但不沿用 Anki 的凌晨四点日界。
- 后续回答使用站内现有 FSRS-6 默认参数及用户 5/10 分钟短期设置。没有导入或训练个人参数，不能承诺未来逐次排期与另一套 Anki 设置完全相同。
- 历史日期、四档评分（包括 Easy=4）、作答用时和原始 revlog 字段全部保留。`algorithm=Anki/imported-history`，`parameters` 保存源哈希与完整 revlog；历史 `version=-1`，不能成为有效撤回目标。
- Anki revlog 不含每次作答前后的完整 S/D，因此历史 `previous/next` 只写已知 state/interval，并标记 `history_only`；不伪造历史记忆快照。原始 APKG、媒体及卡片记录留在私有归档中。62 张卡的 reps 与日志行数不一致，原值分别保存，不自行删日志或修改计数。
- 历史统计沿用 Anki 原用时，总计 191,506,690 ms（约 53.20 小时），不是站内有效阅读时长，也不升级为画像资格。之后的站内计时继续使用前台活动规则。
- 历史 note receipt 和同步词条不动。仅在此账号完成全部 965 个排除词迁移后启用内部 `settings.includeAnki` 兼容开关，并在 `settings.ankiImport` 留下哈希收据；不全站解除待迁移隔离，不恢复网站 Anki UI。

字段依据：[Anki 卡片类型与 FSRS 状态](https://github.com/ankitects/anki/blob/main/rslib/src/card/mod.rs)、[日期计算](https://github.com/ankitects/anki/blob/main/rslib/src/scheduler/timing.rs)。

## 运行与恢复

`scripts/prepare-anki-account-import.py` 只生成私有导入计划和事务 SQL，不联网或自动执行。运行需 Python 与 `zstandard`；不得使用 `python -O`。参数为 `--apkg`、`--snapshot`、`--output`、`--user-id`、带时区的 `--as-of`。快照必须来自服务端核实的目标账号；现有工具刻意只支持此次一词一卡、完整匹配、New/Review 且带 FSRS 状态的场景。

SQL 验证目标 galio 的有效管理员身份；复用账号 study advisory lock，锁定卡片和设置，核对原卡片、设置、当天计划和作答数量。任何并发学习冲突整笔回滚。相同源哈希重复执行直接返回，不覆写后来学习。

私有文件不能提交 Git。正式服务器归档目录 `/var/backups/context-reader/anki-import-20261011/` 仅 root 读取，包含源包、迁移前账号快照、apply/verify/rollback SQL 与计数报告。迁移前完整备份为 `/var/backups/context-reader/postgres/daily/context-reader-20261011T011832Z.dump`（另有 SHA256）。本机私有工作材料在根项目忽略的 `artifacts/anki-import-private/`。

`rollback.sql` 是账号级回退，已在隔离数据库执行并重新导入通过。它要求收据、卡片版本和记忆、账号记录数量及设置仍与导入后相符；如果用户已经继续学习，必须合并新进度，不能绕过保护或拿整库旧备份覆盖正式站。

## 验证

完整备份通过哈希校验并恢复到临时数据库；在那里依次通过导入、965 张记忆逐条比对、201 张原卡不变、7 条原作答不变、1,166 条生词同步对象不变、历史总数/用时/统计、复习目标 100、无新奖励、重复导入无变化，以及回退后再次导入。临时库已删除。

使用精确版本 `ts-fsrs@5.4.2` 和站内 learning-step 策略，对 965 张卡的三档后续作答进行 2,895 次排期验证，结果均有效，Again 为五分钟。正式数据库导入后同样通过逐条内存/原数据/计数/上限/奖励核验。

本次没有替用户答题。内置浏览器没有 galio 登录会话，因此不宣称已完成该会话的界面验收；用户在原有登录浏览器刷新后即可读取新数据。没有创建临时登录凭据或更改密码。
