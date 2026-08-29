# Mainland deployment

This stack keeps the mainland environment self-contained and reversible:

Production never uses Supabase Cloud. The application keeps `SUPABASE_*` compatibility variable names because the server adapters speak Supabase-compatible Auth/REST/Storage protocols, but Compose must bind them to the private `supabase-api` gateway. `start-mainland-app.mjs` refuses to start if the runtime mode or gateway points elsewhere, and public acceptance requires `/api/connectivity` to report `backendMode: "mainland_internal"`.

- `compose.yml`: Next.js standalone app, Supabase-compatible PostgreSQL 17, GoTrue Auth, PostgREST, Storage API, an internal API gateway, and Caddy.
- `compose.shadow.yml`: binds HTTP only to server loopback port `8080`.
- `compose.production.yml`: opens public HTTP/HTTPS only after ICP filing.
- `backup-postgres.sh`: daily custom-format dumps, SHA-256 sidecars, 7 daily / 5 weekly / 12 monthly retention and optional rclone off-site copy.
- `verify-backup.sh`: restores pre-data, data, and post-data into the fixed disposable database `context_reader_restore_check`; it grants the disposable verifier role access to the Vault extension table between schema and data phases, and never overwrites the production database.
- `healthcheck.sh`: checks all seven services, the active shadow or production URL, disk pressure, and backup freshness every five minutes.
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
4. Start the private stack:

   `docker compose --env-file .env -f compose.yml -f compose.shadow.yml up -d --build`

5. From the developer computer, open an SSH tunnel:

   `ssh -L 8080:127.0.0.1:8080 ubuntu@SERVER_IP`

6. Browse `http://127.0.0.1:8080` while the tunnel remains open.

The public ports remain blocked by UFW during shadow mode. After ICP filing and DNS setup, run `cutover-production.sh`; it changes the port overlay only after the DNS guard passes. Never start both shadow and production port overlays together.
