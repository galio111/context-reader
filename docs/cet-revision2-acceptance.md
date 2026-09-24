# CET 第二轮实施与发布验收

状态：**已合入 main 并部署生产；接口、数据及服务核验通过，公网视觉复验未完成**。本机真实 Reader 的桌面/手机、白天/夜间关键路径已通过。浏览器在正式站复验阶段连续连接超时，不能宣称全部77项通过。

## 版本与验收边界

- 任务分支 `codex/cet-revision2`；集成分支 `codex/cet-revision2-release`，均为独立 worktree。
- 源码 main 集成及生产 sourceRevision：`9682ee7d2f33301edf0f9116ca556266a5740c83`。后续 main 仅增加本轮发布证据文档，最终远端 SHA 见最终交付及 `git ls-remote` 记录。
- 已发布 `20260924T041127`，父版本 `20260923T161000`，生产 sourceRevision `9682ee7d2f33301edf0f9116ca556266a5740c83`。公网为 `mainland_internal`，与服务器 current/state 一致。正式接受时间：2026-09-24 12:18:08（Asia/Shanghai）。
- 本机 Windows IAB 的1440×900、390×844和日夜关键路径已验；macOS与物理触屏设备未验。正式站浏览器连接在切换前后持续超时，公网视觉复验仍开放。
- 专用验收账号已按精确ID/昵称/创建日期清理；七服务健康，备份校验和隔离恢复16表通过，当前及父版本镜像保留。未执行回滚。

## 自动检查

- `npm run test:cet`：32/32。含新增计时/快照/作用域/片段偏移、protocol-2 实际客户端 + 两个 jsdom/IndexedDB 设备、A/B 归档与游客认领。该自动用例的传输为内存服务；发布后另用真实生产 protocol-2 接口与两个独立 IndexedDB 环境验证新旧客户端往返，见 T64。
- `npm run test:critical`：89/89。保留外刊图片与高清动效保护。
- `npm run verify:release-contracts` 与 `npm run audit:egress`：通过。
- 模型路由、跨供应商回退、用量报告与计费相关测试：22/22；生产三类 AI 请求的执行记录均为 deepseek-flash，每项 quota_units=1。未人为故障注入生产供应商。
- `npm run lint`：0 errors / 42 warnings。修复原有三个测试中的 any 类型，CommonJS 检查脚本改为等价 ESM 并同步引用，未降低 lint 配置或测试断言。
- `npm.cmd run build`：最后代码修订后正式构建通过，70条路由；正式构建重载后手机Menu关闭、日夜选择器与桌面阅读冒烟通过。
- 相关文章/同步/外刊扩展测试：24/25。唯一失败 `post-review edits and rejected candidates cannot auto-publish` 在取自 HEAD 的未修改测试中同样复现；本轮未改外刊审核业务或放宽此断言。
- CET 旧事件测试的 `onOpenImportedArticle` 返回类型和无效 `ByRoleOptions.exact` 为基线类型问题，已修正；选择器断言按新 listbox 语义更新，原答案/快照断言保持。

本机日志在工作区根目录 `artifacts/cet-revision2-evidence/`：`cet.log`、`critical.log`、`contracts.log`、`egress.log`、`lint.log`、`build.log`、`related-regressions.log`、`baseline-editorial.log`。日志不打包生产。本轮实际截图与网络证据同在该目录；不复用附件旧图。本地服务使用隔离的开发身份及现有解释provider，没有连接旧云端后端。

## R01–R18 实现记录

| 要求 | 文件/模块 | 实现与验证边界 |
|---|---|---|
| R01 | ReaderView / ReaderTextAdapter / CetText / cetTextTokens | 共享 WordToken 与指针处理，完整词边界、局部高亮和源偏移；锁定取消旧查询 |
| R02 | CetSelect / CetReader | 监听清理不抢焦点；20 次对话框开关自动通过，真实 Reader 查词后20次开关通过 |
| R03 | cetViewModel | 题数、题卡、原答案使用固定 scope 与选定快照；范围不一致保留记录并阻止提交 |
| R04 | cetViewModel / CetReader | 六种题卡状态；分篇结果不泄露草稿对错；跨篇跳转等待弹窗解锁 |
| R05 | cetActivity / CetReader | 按范围末篇显示自测提交/练习结束，保留每篇提交及全部草稿 |
| R06 | CetReader / ReaderView / cet.css | 单个可见计时胶囊；手动练习暂停区别于后台暂停；终态显示固定用时 |
| R07 | types/cet / cetActivityStorage / accountSyncClient / learningStorage | 正计时 schema3 与独立 v3 活动/提交前缀；v1/v2 保持，计时设置确认后创建 |
| R08 | ReaderView / cet.css | 自测 Menu 禁用；aria-disabled 实际事件阻断、禁止图标和提示；保留退出/提交/暂停 |
| R09 | CetReader / cet.css | 练习/自测双区、各自历史；取消开始页直接精读和常驻时长 |
| R10 | CetSelect / CetLibrary | 统一 listbox、键盘/外点关闭、模态层内 portal、限高翻转；日夜/桌面/手机实际展开态已验 |
| R11 | cet.css | 仅新 CET 控件取消鼠标焦点粗框，保留 focus-visible |
| R12 | CetReader / cet.css | 空格只显示题号；词库字母与词同胶囊，已用标记不自动作答 |
| R13 | CetLibrary / cet.css | 实际资源双列，历史移到下方，稳定低饱和封面，窄容器/紧凑目录单列 |
| R14 | HomeClient / ReaderView / CetLibraryDialog | 普通文章真实目录入口，取消保留原页，选择时保存编辑并持久化阅读进度 |
| R15 | HomeClient | 保留 CET 独立历史，不写入外刊上次阅读；普通编辑文章→CET→返回继续阅读实测保留 |
| R16 | CetLibrary | 保留切级重置/取消旧请求，增加失效年份/页码回退与空态 |
| R17 | CetReader | 移除正文整行来源，来源保留数据与开始页低优先级资料信息 |
| R18 | cet.css | 新状态日夜样式已实现；Windows日夜/桌面/手机已验，macOS与物理触屏未验 |

## T01–T69 / P01–P08

完整动作、预期与证据方式保存在 [结构化验收表](cet-revision2-acceptance.json)。下面的“部分通过”仍不是该验收项完成。

| 项目 | 状态 | 当前证据 |
|---|---|---|
| T01 | 通过 | Windows IAB: same People token in ordinary Reader and CET uses shared WordToken; real explanation and sentence translation returned. |
| T02 | 通过 | Real CDP mouse drag from token midpoints in both directions returned complete People tend to want / believe this will maximize their. |
| T03 | 通过 | multiline-selection-requests.json: one explain-word-stream request for believe this will maximize their with complete sentence and adjacent context. |
| T04 | 部分通过 | cet-revision2 exact repeated-word offsets passed; browser pending |
| T05 | 部分通过 | cet-revision2 explicit cloze-fragment offsets passed; browser pending |
| T06 | 部分通过 | Real bank approximately, bodyPeople and optionconsiderable lookups verified; A button selects answer. Stem path shared; dedicated stem request not yet captured. |
| T07 | 未验证 | 390x844 layout tested; IAB does not support Input.dispatchTouchEvent. No physical touch hardware, do not claim actual long-press/vertical touch acceptance. |
| T08 | 部分通过 | Running/paused DOM contains plain text and disabled tools; pending lookup abort guarded in code. Artificial late network completion not injected in browser. |
| T09 | 部分通过 | Day/night actual Reader and CET screenshots; shared tokens/style. Full identical-paragraph night screenshot pair not captured. |
| T10 | 通过 | Actual Reader after word lookup: twenty consecutive single-click open/close cycles, each dialog present exactly once. |
| T11 | 通过 | People/considerable lookup highlight retained; answer card and passage submit each opened with one click. |
| T12 | 通过 | Open year list -> one click CET6 closes list and switches level; no focus-stealing cleanup. |
| T13 | 部分通过 | Top-right close and Escape verified in real dialogs; exhaustive backdrop edge points not tested. |
| T14 | 部分通过 | Actual option choose restores focus and outside level click acts once; full mouse/keyboard focus matrix not exhaustive. |
| T15 | 通过（自动） | cet-revision2: paper and each section scope |
| T16 | 通过（自动） | cet-revision2: scope mismatch is diagnosed without deletion |
| T17 | 通过（自动） | cet-revision2: clear answers and per-section snapshots |
| T18 | 部分通过 | Start/history read-only behavior inspected and model tested; exact activity timestamp comparison not captured in real browser. |
| T19 | 通过 | Draft cloze26=C remained neutral after detail46=A submitted; card showed 46 correct and47-50 unanswered. |
| T20 | 部分通过 | Manual countup and real one-minute countdown expiry submitted; answer card shows error/unanswered. Duplicate timer callback covered automatically. |
| T21 | 部分通过 | cet-revision2 selected conflict snapshot count/answers passed; browser pending |
| T22 | 通过 | Card46 from cloze switched to detail1, released body position:fixed, scrolled to y1233 and actual question. |
| T23 | 部分通过 | Whole paper first/middle lacked bottom submit and single/last condition verified in code; complete four-section browser loop pending. |
| T24 | 通过 | Single detail test scope0/5; top and bottom submit present, navigation1/1. |
| T25 | 部分通过 | Cloze/detail unsubmitted have submit and submitted detail removes it; all section types use same condition. |
| T26 | 通过（自动） | cet-revision2: ending from submitted last passage keeps all drafts |
| T27 | 部分通过 | Completed results read-only and fixed elapsed; no browser timestamp audit yet. |
| T28 | 通过 | Real desktop two goal columns and mobile stacked start; screenshots desktop-day-start, desktop-night-start, mobile-night-start. |
| T29 | 通过 | Start page separately listed unfinished practice, paused countdown and completed countup; correct continue actions. |
| T30 | 通过 | Cancelled countdown settings returns to start without starting activity; automated storage assertion confirms no extra record. |
| T31 | 部分通过 | Real countup starts; automated double click creates one ID. Failed start retry uses same ID. |
| T32 | 通过 | Real keyboard empty plus0,-1,1.5,181,abc rejected;1 accepted. Empty fill tool did not edit, so verified with Ctrl+A Backspace. |
| T33 | 通过 | Countup paused at42seconds, reload/history restored42, resumed then submitted65seconds. |
| T34 | 通过 | Countdown pause hides body, timer freezes; resume restored original test. Screenshots desktop-day-countdown-paused/mobile-night-paused. |
| T35 | 部分通过 | Manual practice pause model persisted; visibility listener preserves flag. Full multi-tab browser cycle pending. |
| T36 | 部分通过 | Explicitly paused countup restored after refresh/history; running background progression tested in pure clock model. |
| T37 | 部分通过 | Save/leave code awaits durable pause; actual reload/history pause exercised. |
| T38 | 部分通过 | Real1minute countdown expires and fixes01:00; repeated expiry/late answers tested automatically. Background-expiry browser case pending. |
| T39 | 通过（自动） | cet-revision2: countup has no budget; pause/resume/finalize |
| T40 | 通过 | Submitted countup65seconds remained fixed through answer card and passage switches; countdown expiry fixed60seconds. |
| T41 | 部分通过 | Actual1440x900 and390x844; timer aligned right and mobile inline pill; Final production build screenshots verified; nightcancel/mobilelinks fixed and mobileMenu handle no longer intercepts close. |
| T42 | 部分通过 | Real running/paused tool labels disabled; Menu cannot open, reason/prohibit icon visible. Night tooltip pointer screenshot pending. |
| T43 | 部分通过 | Actual disabled Menu blocks click; aria-disabled rail capture guard and keyboard handlers inspected. Full touch shortcut matrix pending. |
| T44 | 通过 | Start page retains distinct choose-goal disabled reason, no active lookup tools. |
| T45 | 部分通过 | Pause/resume/submit work with disabled Menu; lower-priority end-and-study confirmation implemented/tested in model. |
| T46 | 通过 | After submit Menu, selection, translation and save became available; actual option/body lookups succeeded. |
| T47 | 部分通过 | Year,type,cloze selectors expanded in actual modal/day/night. History/matching selectors share same component but not yet captured. |
| T48 | 部分通过 | Actual End/Enter selectedO in cloze; outsideclick works. Home/Escape/Tab behavior unit/code checked, full keyboard matrix pending. |
| T49 | 部分通过 | Actual390px long cloze list and modal year list fit viewport and scroll. Resize/scroll close implemented. |
| T50 | 部分通过 | Mouse controls have no persistent square outline in screenshots; full every-control matrix pending. |
| T51 | 部分通过 | Listbox keyboard focus visible; all new controls not exhaustively tabbed. |
| T52 | 部分通过 | Actual blank26 shows number, chooser selectsC/O; auto model covers clear. Browser clear pending. |
| T53 | 部分通过 | Actual word bank lookup does not answer; used marker based draft only. |
| T54 | 部分通过 | Duplicate cloze excluded and matching repeats allowed in code; full browser pair pending. |
| T55 | 部分通过 | Actual desktop library computed columns538.594px 538.594px, history below. Screenshot desktop-day-library. |
| T56 | 部分通过 | Real level/type refresh and compact modal/mobile inspected; stable tone IDs code tested. Full paging visual matrix pending. |
| T57 | 通过 | Ordinary Reader library opened/cancelled preserving same article text, scroll0 and People explanation. |
| T58 | 通过 | Real edited text -> library -> stay keeps edit; save-and-open enters CET. Station dialog avoids blocking native confirm. |
| T59 | 通过 | Found and fixed pre-existing unsaved-edit callback clearing temporary slot; repeat edit->CET->home->continue preserved edited sentence. CET never replaced recent article. |
| T60 | 部分通过 | Actual CET6 year2026 -> CET4 resetsrecent. Abort and stale response guard inspected; artificial network reorder pending. |
| T61 | 部分通过 | Invalid filter fallback code and explicit error/empty branches present; browser injected corrupt session/network case pending. |
| T62 | 部分通过 | Source footer absent in practice/selftest/result inspected; data source retained in start details. |
| T63 | 通过（自动） | cet-legacy + cet-activity + cet-revision2: v1/v2 records retained |
| T64 | 通过 | Production protocol-2 real clients with two independent IndexedDB devices: v3 40-second countup finalization, v2 activity and original article preserved; frozen full v2 client roundtrip produced no tombstones. Synthetic QA account precisely deleted; cloud objects zero. |
| T65 | 通过 | Frozen full accountSyncClient + storage from main0526 in test fixture: v2 sync sees v3 wire objects without overwrites/tombstones; new client reopens40second result and articleA. |
| T66 | 通过（自动） | cet-activity + cet-revision2: immutable selected snapshots |
| T67 | 通过 | Real CetReader event tests inject IndexedDB flush failure for start,pause,submit; no premature body/result reveal and retry retains same activity/finalization ID. Offline transport separate from local persistence. |
| T68 | 部分通过 | Real day/night desktop/mobile surfaced and fixed nightmobilelinks and dialogcancel contrast. Final production build screenshots verified; nightcancel/mobilelinks fixed and mobileMenu handle no longer intercepts close. |
| T69 | 通过 | Windows IAB actual Reader paths plus final production build reloaded: CET selection/card/picker/Menu; mobile Menu close now hits Close span and closes once; console no errors. screenshots in artifacts/cet-revision2-evidence. |
| P01 | 通过 | Independent codex/cet-revision2 worktree; live main and public/server release verified 2026-09-24T02:59:37Z |
| P02 | 通过 | 32 CET,89 critical,lint0 errors42 warnings,70-route production build,9 release contracts andegress passed; actual Reader desktop/mobile day/night paths and final build smoke passed. Extended editorial1failure reproduced unchanged baseline; no release gate weakened. |
| P03 | 通过 | Task codex/cet-revision2 pushed; dedicated integration fast-forwarded current main and task. Normal push main to 9682ee7d2f33301edf0f9116ca556266a5740c83, git ls-remote matched. Final documentation commit is reported separately. |
| P04 | 通过 | Clean source 9682ee7d2f33301edf0f9116ca556266a5740c83; exact reviewed delta44; package-release.py and stable server verifier accepted parent 20260923T161000. Latest backup checksum + isolated16-table restore and accepted parent image verified. |
| P05 | 通过 | Stable /opt/context-reader/bin/deploy-release accepted 20260924T041127 at2026-09-24T04:18:08.603377Z. Lock,parent recheck,protected contracts remained enabled; only app/caddy recreated. |
| P06 | 部分通过 | Public release/parent/backend and server source match. Guest6/6,member25/28,answers,auth/sync/Admin boundaries,real v3/v2 sync,lookup+sentence translation,dictionary,full translation,deepseek-flash and one quota unit each,7-service health passed. Public browser repeatedly timed out after local critical paths passed; production visual replay/screenshots remain unverified. |
| P07 | 通过 | No critical regression found and no rollback triggered. Accepted current image cfeb46b05f33 and parent6bcf32b59565 retained; backup context-reader-20260923T191827Z.dump restored16tables. Rollback readiness verified, not an executed rollback drill. |
| P08 | 通过 | Final-state CET/release/decision/brief/contract documents and77-item matrix updated; exact synthetic ID/nickname/date cleanup confirmed user404 and zero cloud objects. Final main is documentation-only after deployed source; normal push/ls-remote recorded in final report. |
