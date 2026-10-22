import { cp, mkdir, readFile } from "node:fs/promises";
const { version } = JSON.parse(await readFile(new URL("../node_modules/pdfjs-dist/package.json", import.meta.url), "utf8"));
const destination = new URL(`../public/document-runtime/${version}/`, import.meta.url);
await mkdir(destination, { recursive: true });
for (const name of ["build/pdf.min.mjs", "build/pdf.worker.min.mjs", "cmaps", "standard_fonts", "wasm"]) {
  await cp(new URL(`../node_modules/pdfjs-dist/${name}`, import.meta.url), new URL(name.split("/").pop(), destination), { recursive: true });
}
