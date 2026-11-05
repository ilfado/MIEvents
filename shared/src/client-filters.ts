import type { MiEvent, EventCategory, PriceBand } from "./index.js";

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
    if (f.priceBand && e.priceBand !== f.priceBand) return false;
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
