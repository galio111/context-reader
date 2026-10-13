import test from "node:test";
import assert from "node:assert/strict";
import config from "../next.config";

test("every page CSP permits same-origin and in-memory recordings without broad media or script access", async () => {
  const rules = await config.headers!();
  const policies = rules.flatMap(rule => rule.headers.filter(header => header.key === "Content-Security-Policy"));
  assert.ok(policies.length >= 4);
  for (const {value} of policies) {
    const media = value.split(";").map(v => v.trim()).find(v => v.startsWith("media-src "));
    assert.equal(media, "media-src 'self' blob:");
    assert.match(value, /object-src 'none'/);
    assert.match(value, /default-src 'self'/);
    assert.doesNotMatch(value, /script-src[^;]*blob:/);
  }
});
