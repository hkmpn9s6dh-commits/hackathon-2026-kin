/**
 * A static server for `dist`, because the tests should not depend on the
 * dev server's flags or on a port the dev server happens to like.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

export async function startServer(dir, port = 0) {
  const root = resolve(dir);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const clean = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      let path = join(root, clean);
      const info = await stat(path).catch(() => null);
      if (!info || info.isDirectory()) path = join(path, 'index.html');
      const body = await readFile(path);
      res.writeHead(200, {
        'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise((done) => server.listen(port, '127.0.0.1', done));
  const address = server.address();
  const actual = typeof address === 'object' && address ? address.port : port;
  return {
    port: actual,
    url: `http://127.0.0.1:${actual}/`,
    close: () => new Promise((done) => server.close(() => done())),
  };
}
