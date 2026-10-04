/** A single-use loopback callback. Invalid requests cannot terminate the login. */
export function oauthStateMatches(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string" || actual.length !== expected.length)
    return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++)
    difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

export function buildGeminiCallbackServerScript(
  resultPath: string,
  expectedState: string,
): string {
  return `
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const resultPath = ${JSON.stringify(resultPath)};
const expectedState = ${JSON.stringify(expectedState)};
let completed = false;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (completed || req.method !== 'GET' || req.headers.host !== 'localhost:8085' || req.headers.origin) {
    res.writeHead(403); res.end('Invalid callback request'); return;
  }
  const parsed = new URL(req.url, 'http://localhost:8085');
  if (parsed.pathname !== '/oauth2callback') { res.writeHead(404); res.end('Not found'); return; }
  const states = parsed.searchParams.getAll('state');
  const state = states[0] || '';
  if (states.length !== 1 || !/^[a-f0-9]{64}$/.test(state) || state.length !== expectedState.length ||
      !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))) {
    res.writeHead(403); res.end('Invalid OAuth state'); return;
  }
  const codes = parsed.searchParams.getAll('code');
  const errors = parsed.searchParams.getAll('error');
  const code = codes[0] || '';
  const error = errors[0] || '';
  if (codes.length > 1 || errors.length > 1 || (!code && !error) || (code && error) || code.length > 4096 || error.length > 1024) {
    res.writeHead(400); res.end('Invalid OAuth result'); return;
  }
  try {
    fs.writeFileSync(resultPath, JSON.stringify({ code, error, state }), { mode: 0o600, flag: 'wx' });
  } catch {
    res.writeHead(500); res.end('Cannot save OAuth result'); return;
  }
  completed = true;
  res.writeHead(200);
  res.end(code ? 'Gemini OAuth complete. Return to Zotero.' : 'Google OAuth was not completed. Return to Zotero.');
  server.close();
  setTimeout(() => process.exit(0), 500);
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.listen(8085, 'localhost');
setTimeout(() => { server.close(); process.exit(1); }, 120000);
`;
}
