import type { MiEvent, EventCategory, PriceBand } from "./index.js";

export const PRICE_BAND_INCLUSIVE: Record<PriceBand, PriceBand[]> = {
  gratis: ["gratis"],
  fino10: ["gratis", "fino10"],
  fino20: ["gratis", "fino10", "fino20"],
  cari: ["cari"],
};

export interface ClientFilters {
  q: string;
  city: string;
  category: EventCategory | "saved" | "";
  priceBand: PriceBand | "";
  from: string;
  to: string;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

export function applyClientFilters(items: MiEvent[], f: ClientFilters): MiEvent[] {
  const q = norm(f.q);
  const qWords = q.split(/\s+/).filter(Boolean);
  return items.filter((e) => {
    if (f.city && e.city !== f.city) return false;
    if (f.category === "saved") {
      if (!e.saved) return false;
    } else if (f.category && e.category !== f.category) return false;
    if (f.priceBand && !PRICE_BAND_INCLUSIVE[f.priceBand].includes(e.priceBand ?? ("cari" as PriceBand))) return false;
    if (f.from && e.start < f.from) return false;
    if (f.to && e.start > f.to) return false;
    if (qWords.length > 0) {
      const hay = norm(`${e.title} ${e.venue ?? ""} ${e.address ?? ""} ${e.city} ${e.description ?? ""}`);
      if (!qWords.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export function geoEvents(items: MiEvent[]): MiEvent[] {
  return items.filter((e) => e.lat != null && e.lon != null);
}

export function withSaved(items: MiEvent[], savedIds: ReadonlySet<string>): MiEvent[] {
  return items.map((e) => ({ ...e, saved: savedIds.has(e.id) }));
}
