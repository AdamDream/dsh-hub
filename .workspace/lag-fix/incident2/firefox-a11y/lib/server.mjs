/*
 * server.mjs — tiny result-collection HTTP server for the a11y probe page.
 * Serves page/a11y-bench.html and accepts one JSON POST per run at /result.
 * Binds 127.0.0.1 on an ephemeral port; nothing external can reach it.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, '..', 'page', 'a11y-bench.html');

export async function startServer() {
  const results = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/result') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { parsed = { parseError: e.message, raw: body.slice(0, 500) }; }
        parsed.receivedAt = new Date().toISOString();
        results.push(parsed);
        res.writeHead(204).end();
      });
      return;
    }
    if (url.pathname === '/page' || url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(fs.readFileSync(PAGE));
      return;
    }
    res.writeHead(404).end('no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    results,
    take: () => results.splice(0, results.length),
    close: () => new Promise((r) => server.close(r)),
  };
}
