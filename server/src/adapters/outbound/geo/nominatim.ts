import type { Geocoder } from "../../../application/ports.js";
import { UA } from "../../../core/text.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const cache = new Map<string, { lat: number; lon: number } | null>();

export function createNominatimGeocoder(): Geocoder & { cacheSize(): number } {
  return {
    async geocode(query) {
      const key = query.toLowerCase();
      if (cache.has(key)) return cache.get(key) ?? null;
      try {
        const res = await fetch(
          `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=it`,
          {
            headers: { "User-Agent": UA, Accept: "application/json" },
            signal: AbortSignal.timeout(8000),
          },
        );
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
        return point;
      } catch {
        return null;
      }
    },
    cacheSize: () => cache.size,
  };
}
