# Mainland deployment

This stack keeps the mainland environment self-contained and reversible:

Production never uses Supabase Cloud. The application keeps `SUPABASE_*` compatibility variable names because the server adapters speak Supabase-compatible Auth/REST/Storage protocols, but Compose must bind them to the private `supabase-api` gateway. `start-mainland-app.mjs` refuses to start if the runtime mode or gateway points elsewhere, and public acceptance requires `/api/connectivity` to report `backendMode: "mainland_internal"`.

- `compose.yml`: Next.js standalone app, Supabase-compatible PostgreSQL 17, GoTrue Auth, PostgREST, Storage API, an internal API gateway, and Caddy.
- `compose.shadow.yml`: binds HTTP only to server loopback port `8080`.
- `compose.production.yml`: opens public HTTP/HTTPS only after ICP filing.
- `backup-postgres.sh`: daily custom-format dumps, SHA-256 sidecars, 7 daily / 5 weekly / 12 monthly retention and optional rclone off-site copy.
- `verify-backup.sh`: restores pre-data, data, and post-data into the fixed disposable database `context_reader_restore_check`; it grants the disposable verifier role access to the Vault extension table between schema and data phases, and never overwrites the production database.
- `verify-usage-migration.sh` + `verify-usage-contracts.sql`: restore a SHA-verified backup into a disposable database, apply a quota migration, and exercise shared `consume_usage` for every existing configured metric plus idempotent replay before production use.
- `backfill-leading-cover-images.sql` + `verify-leading-cover-backfill.sh`: restore an existing reviewed cover into published rows whose body has no valid image, prove the operation is idempotent by running it twice on an isolated restore, and verify the cover is the leading media block.
- `healthcheck.sh`: checks all seven services, the active shadow or production URL, disk pressure, and backup freshness every five minutes.
- `prune-release-images.sh`: holds the deployment lock, preserves the current and direct-parent application images, removes older Context Reader image tags, and prunes only unused dangling image layers. Its daily timer never touches containers, volumes, backups, databases, or versioned release directories.
- `rollback-shadow.sh`: retags a previously accepted application image and restarts only the private shadow stack.
- `cutover-production.sh`: refuses to run until both DNS names resolve to the expected server, switches Caddy to HTTPS, opens only 80/443, and automatically restores shadow mode if acceptance fails.
- `package-release.py`: packages only a clean Git commit whose exact parent-to-candidate delta matches a reviewed JSON file list; it writes the release id, active parent, source commit and protected contracts into the archive manifest.
- `deploy-release.sh`: stable server-side release guard. It serializes cutovers, rejects stale parents and undeclared file deltas, verifies protected contracts, builds and health-checks the candidate identity, then recreates only `app` and `caddy` with `--no-deps`; routine application releases must never recreate PostgreSQL, Auth, REST, Storage, or the internal gateway.
- `verify-release-contracts.sh`: stable verifier installed outside candidate releases at `/opt/context-reader/bin/verify-release-contracts`; a candidate may add contracts but cannot remove the server's existing protected checks.
- `acceptance-admin.py`: verifies the recovery Admin surface and the persisted recommendation configuration without printing its password. It accepts any valid user-configured five-minute run time and 1–10 exact count instead of requiring defaults; `--test-recommendation-email` sends one explicit SMTP test.
- `repair-public-covers.py`: uses the protected Admin API to download, resize, and localize existing external recommendation covers without printing credentials.
- `repair-saved-article-images.py`: uses the protected Admin API to localize external image URLs inside active synced saved-article objects while preserving ids and using compare-and-swap versions.
- `context-reader-recommendations.timer`: wakes the protected crawler every five minutes; the application reads the Admin-controlled enabled/time/exact-count setting (1–10) and never publishes automatically. The service allows up to 15 minutes per attempt and exits non-zero when the requested count is not achieved. Partial progress is persisted by Shanghai date, later wakes request only the remaining count, and the date becomes complete only when the cumulative total reaches the configured target.
- `install-site-email-config.py`: accepts only the whitelisted `SITE_*` SMTP values over standard input and installs them in the private runtime environment with mode `0600`.

Production must call `/opt/context-reader/bin/deploy-release`, not the copy inside the candidate archive, and must never recreate `app` from the legacy mutable `/opt/context-reader/ops/mainland` directory. A successful edit, build or candidate health check is not an accepted deployment. The public `/api/connectivity` response must report the exact new release and parent ids plus `backendMode: "mainland_internal"` before reporting production success. See `docs/release-governance.md` for the cumulative multi-session workflow and rejection recovery.

Recommendation discovery, backup, restore verification, and health checks run on server-side timers even when the developer computer is off. The optional Windows pull task only copies an additional archive after the computer starts; it is not the primary backup job.

New URL imports and newly published recommendation media are first-party assets. Candidate creation may keep a reviewed external cover URL, but publication and ordinary URL intake fetch selected images through the pinned-DNS safe path, convert them to bounded WebP and store them in `public-article-covers`. Use `repair-public-covers.py --id ARTICLE_ID` for legacy public rows and `repair-saved-article-images.py` for active synced saved articles. Both maintenance paths are idempotent; rerun after a transient or compare-and-swap failure.

## First private deployment

1. Run `bootstrap-ubuntu.sh` as root on a fresh Ubuntu 24.04 server.
2. Clone the reviewed repository into `/opt/context-reader`.
3. Copy `env.example` to `.env` and `env.runtime.example` to `.env.runtime`, then fill secrets on the server.
4. From `ops/mainland`, build the app, seed the reviewed public static store, then start the private stack (fresh empty servers only):

   ```sh
   docker compose --env-file .env -f compose.yml -f compose.shadow.yml build app
   bootstrap_release_id="$(date -u +%Y%m%dT%H%M%S)"
   docker tag context-reader-app:latest "context-reader-app:candidate-$bootstrap_release_id"
   python3 retain-next-static.py --image "context-reader-app:candidate-$bootstrap_release_id"
   docker compose --env-file .env -f compose.yml -f compose.shadow.yml up -d --no-build
   ```

5. From the developer computer, open an SSH tunnel:

   `ssh -L 8080:127.0.0.1:8080 ubuntu@SERVER_IP`

6. Browse `http://127.0.0.1:8080` while the tunnel remains open.

The public ports remain blocked by UFW during shadow mode. After ICP filing and DNS setup, run `cutover-production.sh`; it changes the port overlay only after the DNS guard passes. Never start both shadow and production port overlays together.

## Keeping already-open pages usable across releases

`static-asset-retention-v1` makes `/opt/context-reader-shared/next-static` the permanent public store for `/_next/static/*`. Caddy mounts it read-only and serves only GET/HEAD, including JavaScript/CSS MIME types, byte ranges, and existing Brotli/zstd/gzip sidecars. Successful responses are immutable; missing files are real 404 responses without long-lived negative caching. Directory listings and application/HTML fallthrough are disabled. The store contains only allowlisted public build resources; release metadata is kept in the separate, unserved `next-static-manifests` directory.

Before any app/Caddy cutover, the stable `/opt/context-reader/bin/retain-next-static` helper reads `/app/.next/static` from the current accepted image and the candidate image. It does not run the image or mount secrets. Unsafe archive paths, links, devices, source maps and non-public files are rejected. An existing path must have identical size and SHA-256; a collision rejects deployment without replacing that file. New files are added atomically. Identical paths are stored once across releases, and image cleanup never touches this shared store. **There is no age-based or release-count-based asset pruning:** an arbitrarily old page can still need its lazy Reader chunk.

The default storage budget is 1 GiB, with a 1 GiB remaining-disk floor and a 256 MiB extraction limit per source image. Exhaustion rejects the deployment before cutover. Expand storage or make a reviewed budget change to the stable helper; do not delete historical chunks to make deployment pass. Budget checks measure the persistent store plus new assets, while free-space checks also account for temporary staging. Failed staging directories and temporary extraction containers are removed automatically. Source-image inventories with SHA-256 values allow operators to check retention independently of app images.

The first rollout requires a separate reviewed upgrade of the privileged stable tools; a candidate archive must never install its own deployment authority:

1. Export the actual installed `deploy-release` and `verify-release-contracts`; reconcile their cumulative checks with the reviewed Git commit. The repository verifier must preserve the actual production checks even when the old repository copy has drifted.
2. Upload the reviewed `retain-next-static.py`, `verify-release-contracts.sh` and `deploy-release.sh`, plus a SHA-256 list from that exact commit, into a private staging directory. Check the digests before installation.
3. Acquire `/var/lock/context-reader-deploy.lock` and recheck the public accepted release against `/opt/context-reader-current` and the release state. Install each tool as a temporary sibling under `/opt/context-reader/bin`, mode `0755`, and atomically rename it: retainer first, verifier second, deploy entrypoint last. Keep copies of the prior stable tools outside candidate directories. Never install through an unreviewed candidate script.
4. Under that same deployment lock, run the installed helper with one `--image context-reader-app:accepted-RELEASE_ID` per still-available historical accepted image, including the current release and direct parent. Seed these before the image-pruning timer can remove them. If an older image was already deleted, an exact-source rebuild may be seeded under a `candidate-RELEASE_ID` tag only after its original requested chunk names and bytes have been verified; never fabricate an old filename or pretend a reconstruction is an accepted image. Lost resources cannot be recovered by renaming new chunks.
5. Run `python3 ops/mainland/test-retain-next-static.py` on Linux (including symlink tests). Validate the reviewed Caddy config with the actual installed Caddy version and an isolated listener: old/new JS and CSS GET/HEAD, identical SHA-256, immutable success, 404 without immutable, no directory listing, compressed responses, and method rejection. Then use the stable deployment entrypoint normally. It retains the parent and candidate before cutover and retains the global lock/parent recheck/protected contracts.
6. Keep a homepage open across the actual deployment, then open a previously unvisited article and another article after returning home. Confirm the public release/parent identity and that the old page gets the original Reader chunks from the shared store. A successful new-page test does not prove this case.

For an application-image rollback, retain the new shared-static Caddy route and volume mount, then change only the application image under the deployment lock. Do not restore an older release's entire Compose/Caddy configuration: that would remove the retention route even though the files remain. The historical `rollback-shadow.sh` is private-shadow-only; invoke it from the current reviewed configuration, and never use it as a production rollback entrypoint. New private bootstraps must seed build assets before enabling this Caddy route as shown above.
