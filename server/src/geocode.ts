import { fullAddress } from "./normalize.js";
import type { MiEvent } from "@mievents/shared";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = "MIEvents/0.1 (https://github.com/ilfado/MIEvents)";
const cache = new Map<string, { lat: number; lon: number } | null>();

export async function geocodeAddress(
  e: Pick<MiEvent, "address" | "city" | "cap" | "province">,
  opts: { limitMs?: number; sleepMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ lat: number; lon: number } | null> {
  const query = fullAddress(e);
  if (!query) return null;
  const key = query.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=it`;
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(opts.limitMs ?? 8000),
    });
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const arr = (await res.json()) as Array<{ lat: string; lon: string }>;
    const first = arr[0];
    if (!first) {
      cache.set(key, null);
      return null;
    }
    const point = { lat: Number(first.lat), lon: Number(first.lon) };
    cache.set(key, point);
    if (opts.sleepMs) await new Promise((r) => setTimeout(r, opts.sleepMs));
    return point;
  } catch {
    return null;
  }
}

export function geocodeCacheSize(): number {
  return cache.size;
}
