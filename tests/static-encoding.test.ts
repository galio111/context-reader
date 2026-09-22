import test from "node:test";
import assert from "node:assert/strict";
import { acceptsBrotli, staticAssetParts } from "../lib/staticEncoding";

test("Brotli negotiation respects explicit exclusions and malformed quality", () => {
  for (const header of ["gzip, br", "br;q=0.5, gzip;q=1", "BR ; q=1"]) assert.equal(acceptsBrotli(header), true);
  for (const header of [null, "gzip", "*", "br;q=0", "br;q=invalid", "br;q=2", "br;q=-1"]) assert.equal(acceptsBrotli(header), false);
});

test("static asset paths cannot escape the immutable build directory", () => {
  for (const path of [["chunks", "app", "page-a123.js"], ["css", "a123.css"], ["chunks", "app", "[id]", "route-123.js"], ["chunks", "(group)", "@slot", "page-123.js"]]) assert.equal(staticAssetParts(path), true);
  for (const path of [[], ["..", "secret.js"], ["chunks/../secret.js"], [".next", "server", "page.js.br"], ["%2e%2e", "file.js"], ["..\\secret.js"], ["asset.json"]]) assert.equal(staticAssetParts(path), false);
});
