// CLI probes execute server code outside Next. Resolve only its server-only marker.
const { registerHooks } = require('node:module');
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context);
} });
