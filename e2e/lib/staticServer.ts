/**
 * Minimal static file server for the exported web app (app/dist). The export
 * is a single-page app (app.config.ts web.output 'single'), so any path that
 * does not resolve to a file falls back to index.html -- the same contract
 * the production S3 + CloudFront 403/404 -> /index.html rewrite provides.
 */
import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

export interface StaticServer {
  server: Server;
  baseUrl: string;
  close(): Promise<void>;
}

/**
 * Resolve a request path to a file inside `root`, or null for the SPA
 * fallback. Rejects traversal outside the root.
 */
async function resolveFile(root: string, urlPath: string): Promise<string | null> {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const joined = path.normalize(path.join(root, decoded));
  if (!joined.startsWith(root + path.sep) && joined !== root) {
    return null;
  }
  try {
    const stat = await fs.stat(joined);
    if (stat.isFile()) return joined;
    if (stat.isDirectory()) {
      const index = path.join(joined, 'index.html');
      const indexStat = await fs.stat(index);
      return indexStat.isFile() ? index : null;
    }
    return null;
  } catch {
    // Not found -> SPA fallback; the caller serves index.html.
    return null;
  }
}

/** Start serving `root` on 127.0.0.1:`port` (port 0 = ephemeral). */
export function startStaticServer(
  root: string,
  port: number,
): Promise<StaticServer> {
  const absoluteRoot = path.resolve(root);

  const server = createServer((req, res) => {
    void (async () => {
      const urlPath = req.url ?? '/';
      const file =
        (await resolveFile(absoluteRoot, urlPath)) ??
        path.join(absoluteRoot, 'index.html');
      try {
        const body = await fs.readFile(file);
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, {
          'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(body);
      } catch (error) {
        // index.html itself unreadable: the export is broken; surface it.
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`e2e static server failed to read ${file}: ${String(error)}`);
      }
    })();
  });

  return new Promise<StaticServer>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('static server reported no usable address'));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) =>
              error ? rejectClose(error) : resolveClose(),
            );
          }),
      });
    });
  });
}
