# Production Release Governance

This file is the final-state contract for parallel development and mainland production releases. It exists to prevent a later task from silently publishing an older source snapshot and removing work that another task already shipped.

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

## Parallel-session behavior

Development may run in parallel in separate branches/worktrees. Production integration is deliberately serialized:

- Start each code task with `powershell -File scripts/new-task-worktree.ps1 -TaskName <short-name> -BaseRef <reviewed-base>`. The helper creates only a `codex/*` branch below `artifacts/task-worktrees/` and refuses an existing branch or directory.
- Keep task worktrees bounded: 8 is the normal retained target and 12 is the hard cap. On creation, clean worktrees older than 24 hours are removed oldest-first when needed, including unmerged task directories at the hard cap; their branches and commits remain available. Current, dirty, locked, recent, detached, and orphan directories are never auto-removed, and creation stops if those protections prevent convergence below 12.
- Commit each task before handoff. Production integration merges or cherry-picks those commits; it never copies one worktree wholesale over another.
- After handoff, remove the task worktree promptly rather than retaining its `node_modules` and `.next` outputs as an informal backup. Git branches and commits are the durable history.

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
