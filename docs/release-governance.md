# Production Release Governance

This file is the final-state contract for parallel development and mainland production releases. It exists to prevent a later task from silently publishing an older source snapshot and removing work that another task already shipped.

## Current accepted third-round release (2026-09-25)

Accepted `20260924T184912`, parent `20260924T041127`, source `f87313909b3d3d12820ec5f07af7d9d9e47a1c10`. Public mainland identity, resolved current path and manifest agree. Clean cumulative 39-file package used the stable guarded entrypoint; only app/caddy recreated. Post-release account/sync/AI/Admin boundaries, real Reader submit-all, homepage switching and embedded guide were verified; full visual matrix remains partial. Latest backup SHA and isolated 16-table restore passed; current/parent images exist, no rollback performed. See [third-round evidence](cet-revision3-release.md) for R01–R16 and limits. Later main changes are documentation only.

## The three different copies of “the code”

- The shared working directory is an editing surface. It may contain incomplete and unrelated changes from several tasks and is never a production source.
- A Git commit in a dedicated release worktree is the reviewed integration source. It is immutable and gives every included change durable history.
- `/opt/context-reader-releases/<releaseId>` is the immutable production snapshot built from that commit. `/opt/context-reader-current` points to exactly one accepted snapshot.

A local edit can remain present while production uses a later package that omitted it. Conversely, an uncommitted local edit can be overwritten by another session. Only a clean integration commit plus an accepted release manifest connects local work to production.

## Required workflow

1. Read the public `/api/connectivity` identity and the server's `/opt/context-reader-release-state.json`. Treat its `releaseId` as the only valid parent.
2. Create a dedicated Git worktree and integration branch from the source commit recorded for that accepted release. Never build a production archive from the shared dirty workspace.
3. Merge or reapply all intended task commits into that worktree. Resolve conflicts there; do not copy a whole old candidate over the current production source.
4. Run `npm ci`, `npm run verify:release-contracts`, the production build and affected tests. Commit the complete result. The worktree must be clean.
5. Review the exact parent-to-candidate file delta and store it as a JSON array. Run `ops/mainland/package-release.py`; it refuses a dirty checkout, a mismatched Git SHA, undeclared changes and false changed-file entries.
6. Upload the archive and invoke the stable server command `/opt/context-reader/bin/deploy-release RELEASE_ID ARCHIVE_PATH`. Do not execute `deploy-release.sh` from the candidate directory as the authority for that candidate.
7. The server takes `/var/lock/context-reader-deploy.lock`, validates the manifest and protected contracts, compares the archive byte inventory to its declared delta, builds a candidate image, checks its release identity and `backendMode: "mainland_internal"`, rechecks the parent immediately before cutover, then recreates only `app` and `caddy`.
8. Verify the public `/api/connectivity` reports the exact release and parent ids plus `backendMode: "mainland_internal"`. Then verify the affected UI/API behavior, account/sync/Admin boundaries, full-stack health, latest backup restore and rollback image. Only after those checks may the task say “production deployed”.

The mutable bootstrap checkout at `/opt/context-reader/ops/mainland` is not a release source. It may retain core-service maintenance material, but it must never be used to recreate `app`; doing so can bypass cumulative release files and environment overrides. Production app recovery must use the accepted snapshot resolved by `/opt/context-reader-current` or the stable release entrypoint.

The isolated `ops/vercel-overseas-fetcher/` project has its own Vercel deployment lifecycle and may expose only `api/fetch.mjs`. Never deploy the repository root or full Next.js app to that project. Its server-only token must be rotated independently and installed only in ignored Vercel/mainland runtime environments. Changing the mainland caller still requires this complete versioned release workflow; changing only the relay does not authorize an application, database, or legacy Vercel deployment.

## Parallel-session behavior

Development may run in parallel in separate branches/worktrees. Production integration is deliberately serialized:

- Start each code task with `powershell -File scripts/new-task-worktree.ps1 -TaskName <short-name> -BaseRef <reviewed-base>`. The helper creates only a `codex/*` branch below `artifacts/task-worktrees/` and refuses an existing branch or directory.
- Commit each task before handoff. Production integration merges or cherry-picks those commits; it never copies one worktree wholesale over another.

- If two tasks package from the same parent, the first accepted release advances production. The second package is rejected with `parent release mismatch` and must be integrated again on top of the new parent.
- If two deploy commands overlap, the second is rejected by the global deployment lock.
- If a package accidentally includes another task's unfinished file, the exact `changedFiles` comparison rejects it unless the file was explicitly reviewed.
- If a later candidate drops a protected behavior such as current-form phonetic ownership, the stable server verifier rejects it even if its own candidate scripts were weakened.

Do not bypass a rejection by changing only the parent id, weakening the verifier, deleting a contract or running the candidate's deploy script directly. Rebuild a cumulative candidate from the current accepted release.

## Release identity and audit

Every release manifest contains:

- `releaseId`: immutable timestamp id of the candidate;
- `parentReleaseId`: exact accepted production parent;
- `sourceRevision`: full 40-character Git commit of the clean release worktree;
- `guardVersion`: minimum stable deploy-guard version;
- `requiredContracts`: cumulative protected behavior contracts;
- `changedFiles`: exact reviewed parent-to-candidate delta.

The application exposes its embedded release and parent ids through `/api/connectivity`. After acceptance, the server writes `/opt/context-reader-release-state.json` and appends the same identity to `/var/log/context-reader-release-audit.jsonl`. These records distinguish “code exists locally”, “candidate built”, and “production accepted”.

## Recovery

If production behavior does not match the expected release:

1. Stop describing it as deployed and record the observed public release id.
2. Preserve the current snapshot and audit log; do not delete evidence.
3. Locate the missing change by its task commit or historical accepted release.
4. Create a cumulative candidate from the current accepted production source, merge the missing commit and repeat the full guarded workflow.
5. Roll back only to a known accepted image when the current version is unsafe; a rollback also becomes the next explicit production parent.

## Application-image retention

The production host keeps `latest`, accepted and candidate tags for both the active release and its direct parent. `ops/mainland/prune-release-images.sh` takes the same global deployment lock, resolves those two releases from the current symlink and release-state file, refuses to run if a protected tag is missing, removes only older `context-reader-app` tags, and then prunes unused dangling layers. Its daily systemd timer does not remove containers, volumes, databases, backups, immutable release directories or images used by the core services. Any broader Docker cleanup requires a separate inventory and explicit approval.

## GitHub synchronization gate

After each completed and validated update, push the reviewed task branch and integrate the cumulative accepted production source plus final documentation into default `main`. Branch-only delivery does not update ChatGPT's default repository context. Start from the live accepted `sourceRevision`, merge the current remote main without dropping its history, review conflicts, and verify the integration. Use a normal non-force push; a concurrent main update requires fetch/re-integration. Check `git ls-remote origin refs/heads/main` equals the exact integration SHA before reporting GitHub synchronized. Do not checkout/reset the shared dirty main worktree to perform this operation; push the dedicated integration branch to main explicitly. A source-only sync does not authorize or require redeployment.

Local integration validation on 2026-09-18 passed the production build, 89 critical regressions, 22 targeted quota/pronunciation/storage/session regressions, release contracts and the static egress guard. The application code matches the accepted production source; only documentation, ignore rules and reviewed workstation worktree scripts differ. Remote publication evidence belongs in the dated product journey entry.

## Previous second-round acceptance

已发布 `20260924T041127`，父版本 `20260923T161000`，生产 sourceRevision `9682ee7d2f33301edf0f9116ca556266a5740c83`。公网为 `mainland_internal`，与服务器 current/state 一致。正式接受北京时间2026-09-24 12:18:08。32CET/89关键/22AI路由用量测试、9保护契约、出口审计、lint与本机/服务器build通过。真实生产新旧v2/v3客户端跨两IndexedDB环境同步、普通文章保持、AI三功能默认模型及各一次计费、Admin边界、7服务、16表备份恢复及当前/父镜像通过；精准清理本轮合成账号。仅重建app/caddy，未回滚。本机真实Reader日夜桌面/手机已验，公网视觉受浏览器连接超时影响未复验，P06部分通过；完整证据见 [第二轮发布记录](cet-revision2-release.md)。

### Previous image acceptance

最新图片层修复已发布 `20260923T161000`（parent `20260923T150500`，source `aeba5ab75060feb7b0bb122072e60ee4eeb67547`）。原高清封面恢复为所有近视口/指针进入卡片的最终图片，预览与高清共用原 3D 图片层。组件实际挂载测试覆盖倾斜/复位、关闭动效、近视口高清请求和加载成功覆盖预览；核心回归、展开动效回归、本机/服务器正式构建、发布契约及出口审计通过。公网版本/父版本/大陆内部模式与软链接一致，首页有真实预览 img 元素，匿名同步/Admin 为 401，七服务及当前/父镜像正常；仅重建 app/caddy。浏览器连接失败，视觉验收保持开放。

### Previous accepted CET release

已上线 `20260923T150500`（parent `20260923T133000`，source `5c2b8dc6925d3ef13a98ffd938c67a474e417199`）。公共 `/api/connectivity` 与 `/opt/context-reader-current` 核对一致且为 `mainland_internal`。累计 132 项回归（89 核心、22 CET、21 同步/目录/用量）、本机和服务器正式构建、发布契约及出口审计通过。公网游客每级六套、签入目录四级 25/六级 28 套、单卷材料身份/答案解析、匿名同步/Admin 边界通过；合成账号注册、会话、登录、三个 CET v2 命名空间往返及旧版本写入 409 拒绝通过，三次验收账号已按精确 id/昵称/创建日期清理。恢复 Admin、七服务健康、最新备份隔离恢复 16 表和当前/父回滚镜像通过；仅重建 app/caddy。

本机最终生产构建实际检查了 1440×900 启动页/侧栏、390×844 无横向溢出与选词列表、夜间正文、刷新后继续保留草稿、按篇提交和下一篇独立作答、历史 Escape 关闭；修复新增侧栏标签被原图标网格挤成竖排的问题。正式站浏览器在复查时连接中断，公网视觉复查及用户最终观感验收仍开放，不能把 API 验证等同于视觉确认。既有精选图片动效文件与直接父版本保持一致；完整目录首次冷加载问题继续见 featured-image-scroll-open-issue.md。

### Previous featured-motion acceptance

已上线 `20260923T133000`（parent `20260923T130100`，source `00e106ecf4bd57a6f2c525f5080780d5e160e195`）。此版恢复上一轮误关的展开库存图片出现/离开/再次进入动效和按用户偏好启用的指针反馈；`AGENTS.md`、首页契约及受保护发布检查已明确禁止把关闭既有动效当成性能优化。公共 `/api/connectivity` 报告准确版本/父版本及 `mainland_internal`，`/opt/context-reader-current` 指向准确发布目录；线上 CSS 有 0.90 入场状态且无展开库存动效禁用规则。479 个既有封面预览均为 256×192，另两篇旧文纯文本；目录缓存重复请求此前在线验证 304、零正文，双路首次冷目录仍需 17.68/20.44 秒。正式构建、420 卡动效回归、发布契约、出口审计、七服务健康、匿名账号/Admin 边界与当前/父镜像通过；仅重建 app/caddy。独立 critical 套件因既有 `server-only` 缺失而未执行；浏览器工具不可用，登录快滑、动效和返回卡片的视觉验收仍开放，详见 [精选图片滚动问题](featured-image-scroll-open-issue.md)。

### Previous performance acceptance

Accepted production `20260922T102600`, parent `20260922T101400`, source `bb50d2ba144737e23ef436eb61726012c0cb6c1b`. Public mainland identity and current symlink agree. Three-user desktop/mobile cold readiness is 1.46–3.32 s on the final release; aligned Menu/dictionary/Reader and isolated concurrent account save/sync/conflict checks passed during the code series. Final video samples have zero continuous-playback buffering, but cold start still reaches 5.37 s: do not claim every operation has zero waiting or unrestricted 1,000-DAU certification. All 426 published records and visible fields remain; exact first showcases are SSR and the full catalogue loads progressively. Builds, 105 focused regressions, release contracts, egress audit and 113 live byte-identical Brotli assets pass. Recovery Admin reads, anonymous boundaries, seven-service health, isolated 16-table backup restore and accepted current/parent images pass. Three synthetic accounts were deleted by exact id/name/time predicates. Only app/caddy recreated; no infrastructure purchase, model/quota change or backend restart. See cold-start-performance.md for complete evidence and limits.

The intermediate `20260922T090800` root rendering incident was rolled back and fixed before subsequent acceptance. The separately reviewed stable deploy entrypoint now checks the real candidate homepage before cutover, while retaining its global lock, parent checks and protected contracts. The deployed-source SHA and the later documentation-only main integration are distinct; source edits or branch-only pushes are not production acceptance.
