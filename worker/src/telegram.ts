import { log } from './log.ts';

export class TgError extends Error {
  constructor(public code: number, public description: string, public retryAfter = 0, public network = false) {
    super(`tg ${code}: ${description}`);
  }
}

export interface TgApi {
  /** money=true: never retried after the request may have reached Telegram (only 429 is retried). */
  call<T = unknown>(method: string, params?: Record<string, unknown>, opts?: { money?: boolean }): Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bot API client with bounded retries + backoff (429 retry_after, 5xx, network for safe calls). */
export class Tg implements TgApi {
  constructor(private token: string, private fetchImpl: typeof fetch = (input, init) => fetch(input, init), private maxTries = 3) {}

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, opts: { money?: boolean } = {}): Promise<T> {
    let lastErr: TgError | null = null;
    for (let attempt = 1; attempt <= this.maxTries; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params),
        });
      } catch (e) {
        lastErr = new TgError(0, e instanceof Error ? e.message : 'network', 0, true);
        if (opts.money) throw lastErr; // outcome unknown: never resend money calls blindly
        await sleep(300 * 2 ** (attempt - 1));
        continue;
      }
      let body: { ok: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };
      try { body = await res.json(); } catch { body = { ok: false, error_code: res.status, description: 'bad json' }; }
      if (body.ok) return body.result as T;
      const code = body.error_code ?? res.status;
      const retryAfter = body.parameters?.retry_after ?? 0;
      lastErr = new TgError(code, body.description ?? 'error', retryAfter);
      const retryable = code === 429 ? retryAfter <= 5 : code >= 500 && !opts.money;
      if (!retryable || attempt === this.maxTries) break;
      log('warn', 'tg_retry', { method, code, attempt });
      await sleep(code === 429 ? retryAfter * 1000 : 300 * 2 ** (attempt - 1));
    }
    throw lastErr ?? new TgError(0, 'unknown', 0, true);
  }
}
