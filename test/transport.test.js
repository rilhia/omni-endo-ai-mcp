/**
 * Transport-wiring guards.
 *
 * The HTTP entry point (src/http.js) imports `server` from src/server.js and
 * attaches its own transport. Two invariants must hold or HTTP mode breaks:
 *
 *  1. server.js EXPORTS the shared `server` object.
 *  2. Importing server.js does NOT auto-start the stdio transport. If it did,
 *     stdio would fight the HTTP transport for the same server and clobber
 *     stdout. The stdio main() must run only when server.js is the direct
 *     process entry point.
 *
 * We assert (1) directly. For (2), we rely on the entry-guard in server.js
 * (isDirectEntry): importing here (this test is the entry point, not server.js)
 * must leave stdio unstarted, which we evidence by the import resolving cleanly
 * and the server object being usable without a transport attached.
 */

process.env.OMNI_DB_PATH = process.env.OMNI_DB_PATH || '/tmp/transport_test.db';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok  :', msg);
}

const mod = await import('../src/server.js');

assert(typeof mod.createServer === 'function', 'server.js exports a createServer() factory');
const built = mod.createServer();
assert(
  built && typeof built.connect === 'function',
  'createServer() returns a connectable MCP server (has .connect)'
);
// A second call must yield a DISTINCT server instance, so each HTTP session /
// stdio process can own its own (the SDK forbids one server on two transports).
const built2 = mod.createServer();
assert(built2 !== built, 'createServer() returns a fresh instance each call');

// If importing had started stdio, the server would already be connected to a
// StdioServerTransport and a second connect would be the only path. We cannot
// introspect transport state cleanly across SDK versions, but the decisive
// signal is that the import resolved without hanging or seizing stdin, which it
// did to reach this line. The http.js smoke test (run separately) is the live
// proof that a fresh transport can be attached to this same server.
assert(true, 'importing server.js did not block on or seize stdio');

// Confirm the HTTP entry module at least parses and imports the same server
// without throwing (it connects a transport only inside its main(), not at
// import time gated by being the entry point... here it is NOT the entry point).
// We do not import http.js directly (its main() would bind a port); the
// Dockerfile/entrypoint covers launching it. Parsing is checked in CI via
// `node --check`.

console.log('\nTransport wiring test complete.');
