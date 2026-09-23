// Node tests exercise server modules outside Next's compiler alias layer.
// Keep the production server-only boundary intact; only the test loader maps it.
import { registerHooks, createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const emptyServerMarker = pathToFileURL(require.resolve("next/dist/compiled/server-only/empty.js")).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: emptyServerMarker, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
