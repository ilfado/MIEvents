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
  const res = await fetchImpl(url, {
    headers: { "User-Agent": UA, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
