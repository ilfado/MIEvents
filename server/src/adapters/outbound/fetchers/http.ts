import { UA } from "../../../core/text.js";

export class HttpError extends Error {
  status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${redactUrl(url)}`);
    this.name = "HttpError";
    this.status = status;
  }
}

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return "[invalid-url]";
  }
}

export async function getText(fetchImpl: typeof fetch, url: string, accept = "text/html,application/json,application/ld+json,*/*"): Promise<string> {
  const res = await fetchImpl(url, {
    headers: { "User-Agent": UA, Accept: accept },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return res.text();
}

export async function getJson(fetchImpl: typeof fetch, url: string, headers: Record<string, string> = {}, maxRetries = 3): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": UA, Accept: "application/json", ...headers },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new HttpError(res.status, url);
      return await res.json();
    } catch (err) {
      lastErr = err;
      const status = err instanceof HttpError ? err.status : 0;
      const retryable = status === 429 || status >= 500;
      if (!retryable || attempt === maxRetries) break;
      await sleep(2000 * 2 ** attempt + Math.floor(Math.random() * 1000));
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
