import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompress, constants } from 'node:zlib';
import { promisify } from 'node:util';
const compress = promisify(brotliCompress);
let count = 0, rawBytes = 0, wireBytes = 0;
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await visit(path); continue; }
    if (!/\.(js|css)$/.test(entry.name)) continue;
    const source = await readFile(path);
    const encoded = await compress(source, { params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
    } });
    await writeFile(path + '.br', encoded);
    count++; rawBytes += source.length; wireBytes += encoded.length;
  }
}
await visit('.next/static');
console.log(JSON.stringify({ precompressedAssets: count, rawBytes, brotliBytes: wireBytes }));
