# Reading across application releases

## Contract

An already-open homepage must retain access to the exact JavaScript and CSS URLs it loaded before a release. Opening an article or CET paper after a release must not require refreshing the page. Published assets remain immutable and are not removed when old Docker images are cleaned up. API and stored-data compatibility remain separate release requirements.

Public build assets live in `/opt/context-reader-shared/next-static`, outside the current application image. Caddy mounts this directory read-only and serves `/_next/static/*` directly. Successful responses retain immutable caching and negotiated gzip/zstd delivery; missing resources remain real errors rather than an HTML app shell. Only public Next.js build assets may enter the store, with path/type validation and identical-byte deduplication. Conflicting bytes at an existing URL stop publication.

The stable deployment entrypoint preserves the current accepted image's assets and stages the candidate assets before switching app/caddy. The shared store has a capacity guard; reaching it stops the release before cutover instead of deleting files that an open page may still need. There is no automatic age expiry. The release lock, exact parent, source revision, archive delta and protected contracts remain required. App-only releases do not restart the database, Auth, REST, Storage or internal gateway.

Reader and CET loading also have a local recovery boundary. A failed module load or render shows a short Chinese explanation, manual retry and return-home actions while HomeClient retains its article state. Retry creates a new lazy import instance; it does not reload the whole page or loop automatically. Returning from a failed imported article preserves the home import draft. Diagnostics omit article contents, arbitrary exception messages and URL query strings. Repeated equivalent failures are throttled.

## Operations

Install reviewed stable scripts separately under the deployment lock before the first protected release. Seed available accepted images before activating the Caddy route; a historical image reconstructed only for asset recovery must not be labelled as an accepted production release. Confirm the original hashed files actually exist after reconstruction. Never rename different bytes to satisfy an old hash URL.

Application rollback must retain the shared static mount and current Caddy static route. Do not restore an old whole Compose/Caddy configuration that predates asset retention. Asset data and its per-image manifests are independent of rollback image retention; include both shared directories in infrastructure recovery planning. See `ops/mainland/README.md` for the reviewed installation and seeding commands.

## Verification and status

Implementation is undergoing local and deployment validation. Production acceptance requires the public release/parent identity, a homepage held open across cutover, the old Reader resource fetched from the server with unchanged bytes, successful article entry without a document reload, retry/return behavior after a deliberately blocked resource, account/sync/Admin boundaries, health, backup restoration and rollback-image checks. New-tab success alone does not establish this contract.

The incident was confirmed from 2026-10-13 production logs: release `20261013T063535` was accepted at 14:42:19 China time; an older Safari page fetched the article successfully at 14:55:22, then requested `/_next/static/chunks/6063-fc805f9af6d50219.js` at 14:55:28 and received 404. The previous `20261013T031701` image's loadable manifest identifies that URL as a HomeClient Reader dependency. The screenshot was taken at 14:55:43. This was a missing old build asset, not an article API failure.
