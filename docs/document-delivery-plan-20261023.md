# Private PDF delivery proposal

Status: proposed, no billable resource created. Current application release is 20261023T234000. Cold reading still fails the user's WPS-level acceptance requirement.

## Proposed delivery path

Keep authentication, learning records, application database and existing originals on the current mainland stack. Copy original PDF bytes into a private Tencent COS bucket in Shanghai, verifying SHA-256 before enabling delivery. An authenticated application endpoint checks document ownership and returns an object-specific short-lived signed GET URL. The browser reads ranges directly from COS, bypassing the app host's measured 3.08 Mbps uplink, then retains the existing account-scoped local cache.

Use least-privilege credentials, restricted CORS and expiration renewal. Do not make the bucket public. Signed URLs are bearer access for their lifetime and must not enter logs or durable article records. An unsuccessful direct read falls back to the existing authenticated source. Preserve current originals until a separately approved retention change; rollback disables direct delivery without database or learning-record changes.

## Cost and approval boundary

Exact current Shanghai prices and this account's eligible packages have not been verified in the billing console. Official documentation examples are not a binding current quote. Before creating any resource, present storage, requests and external-download pricing, any minimum commitment, and an estimated monthly total for the user's usage. No purchase, bucket creation or new-service upload has been authorized yet.

For a reviewable volume example, 100 originals averaging 20 MB consume approximately 2 GB. Downloading each once on three fresh devices transfers approximately 6 GB; repeated opening from a populated browser cache does not transfer the PDF again. Pricing must apply the service's own billing units, request fees and taxes rather than assuming a fixed monthly ceiling. Budget alerts are not necessarily a hard spending cap.

Upgrading the whole server is an alternative, but eligible upgrades and restart requirements must be checked in the account console. Published cheaper two-core packages cannot be assumed eligible upgrades for the current four-core host.

## Acceptance before cutover

Measure the actual 16-page IJBM and older SCM originals under fresh and populated browser caches. Record first visible page, immediate jumps to pages four/five, complete page preparation, continuous scroll, zoom, selection and reopen. Verify source hashes, unauthenticated and cross-account denial, URL expiration and fallback. Keep cold download and local rendering timings separate. Physical WPS comparison and user acceptance remain explicit gates; a faster transport test alone is insufficient.

## Official references

- [COS signed downloads](https://cloud.tencent.cn/document/product/436/14116): private object authorization and expiring URLs.
- [COS storage billing](https://cloud.tencent.com/document/product/436/53482) and [current pricing calculator](https://buy.cloud.tencent.com/price/cos): exact account/region quote still required.
- [Lighthouse package upgrades](https://cloud.tencent.com/document/product/1207/51730): upgrade eligibility and possible restart.
