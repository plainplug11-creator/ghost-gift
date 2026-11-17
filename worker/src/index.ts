import { createApp, type AppReq } from './app.ts';
import { loadConfig, type Env } from './config.ts';

const MAX_BODY = 64 * 1024;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cfg = loadConfig(env);
    if (!cfg.botToken) return json(500, { error: 'BUSY' }); // BOT_TOKEN secret missing
    const len = Number(request.headers.get('content-length') || 0);
    if (len > MAX_BODY) return json(413, { error: 'BUSY' });
    const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
    if (body.length > MAX_BODY) return json(413, { error: 'BUSY' });

    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => { headers[k] = v; });
    const ip = request.headers.get('cf-connecting-ip')
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
    const appReq: AppReq = { method: request.method, url: request.url, headers, body, ip };

    const out = await createApp(env.DB, cfg).handle(appReq);
    const payload = out.status === 204 ? null : typeof out.body === 'string' ? out.body : JSON.stringify(out.body);
    return new Response(payload, {
      status: out.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...(out.headers || {}) },
    });
  },
} satisfies ExportedHandler<Env>;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
