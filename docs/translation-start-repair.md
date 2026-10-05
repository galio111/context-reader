# Full translation start request

Status: candidate for mainland production; public acceptance remains pending.

Generated jobs submit their exact target `blocks` to `/api/translate-article/start`. The server needs the text to reserve English-word points and store the hashes used by streaming block claims. Continuation submits missing blocks only; regeneration submits replacement blocks while preserving existing translations. Full article context remains in `contextBlocks` on the provider request. Public-cache starts retain server-validated publication text and their existing first-use charge.

The former client sent only `articleCharacters` and `blockCount`, which made every generated cloud-account job fail with HTTP 400 and “文章段落无效，请刷新后重试。” before AI work or point reservation. An ordinary production account reproduced this against `20261004T212050`; its point usage stayed 0.

Validation: a job-level regression fails with the former payload and passes for new translation, missing-block continuation and regeneration with retained translations. All 90 critical checks, translation batching and billing policy checks, nine release contracts and the egress guard passed. Production build passed with existing lint warnings. The additional unchanged provider-billing fixture failed because its mocked usage result lacks the identity now required by the dictionary route; real public dictionary validation will supplement this unrelated fixture failure.

Planned release: `20261005T124000`, parent `20261004T212050`. Accepted source, public translation/account/sync/Admin checks, service health, backup restore and rollback evidence will be recorded after cutover. Physical-device confirmation of the original reported screen remains open.
