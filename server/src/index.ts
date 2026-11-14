import { createServer } from 'node:http';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { createApp, type AppReq } from './app.ts';

const cfg = loadConfig();
if (!cfg.botToken) {
  console.error('Set BOT_TOKEN or GHOST_GIFT_BOT_TOKEN');
  process.exit(1);
}

const db = openDb(cfg.databasePath);
const { handle } = createApp(db, cfg);

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  const tooBig = () => { res.writeHead(413).end('{"error":"BUSY"}'); };
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > 64 * 1024) { req.destroy(); tooBig(); return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (res.writableEnded) return;
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      || req.socket.remoteAddress || '';
    const appReq: AppReq = {
      method: req.method || 'GET',
      url: req.url || '/',
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v || ''])),
      body: Buffer.concat(chunks).toString('utf8'),
      ip,
    };
    const out = await handle(appReq);
    const headers = { 'Content-Type': 'application/json; charset=utf-8', ...(out.headers || {}) };
    res.writeHead(out.status, headers);
    res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body));
  });
});

server.listen(cfg.port, () => {
  console.log(`ghost-gift server on :${cfg.port}`);
});
