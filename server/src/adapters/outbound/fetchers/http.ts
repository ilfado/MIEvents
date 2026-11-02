import { UA } from "../../../core/text.js";

export async function getText(fetchImpl: typeof fetch, url: string, accept = "text/html,application/json,application/ld+json,*/*"): Promise<string> {
  const res = await fetchImpl(url, {
    headers: { "User-Agent": UA, Accept: accept },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function getJson(fetchImpl: typeof fetch, url: string, headers: Record<string, string> = {}): Promise<unknown> {
  return getWithRetry(fetchImpl, url, headers, "application/json");
}

export async function getJsonRetryable(fetchImpl: typeof fetch, url: string, headers: Record<string, string> = {}, maxRetries = 3): Promise<unknown> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await getWithRetry(fetchImpl, url, headers, "application/json", 0);
    } catch (err) {
      lastErr = err as Error;
      const status = /HTTP (\d{3})/.exec(lastErr.message)?.[1];
      const retryable = status === "429" || (status && Number(status) >= 500);
      if (!retryable || attempt === maxRetries) break;
      const wait = 2000 * 2 ** attempt + Math.floor(Math.random() * 1000);
      await sleep(wait);
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

async function getWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  accept: string,
  _depth = 0,
): Promise<unknown> {
  const res = await fetchImpl(url, {
    headers: { "User-Agent": UA, Accept: accept, ...headers },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
