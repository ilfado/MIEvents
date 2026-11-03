import type { EventCategory, EventsResponse, MiEvent, PriceBand } from "@mievents/shared";

export interface Filters {
  q: string;
  city: string;
  category: EventCategory | "saved" | "";
  priceBand: PriceBand | "";
  from: string;
  to: string;
  bbox?: string;
  offset?: number;
  geoOnly?: boolean;
}

export const EMPTY_FILTERS: Filters = { q: "", city: "", category: "", priceBand: "", from: "", to: "" };

export async function fetchEvents(f: Filters): Promise<EventsResponse> {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.city) params.set("city", f.city);
  if (f.category) params.set("category", f.category);
  if (f.priceBand) params.set("priceBand", f.priceBand);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.bbox) params.set("bbox", f.bbox);
  if (f.offset) params.set("offset", String(f.offset));
  if (f.geoOnly) params.set("geo", "1");
  const res = await fetch(`/api/events?${params.toString()}`);
  if (!res.ok) throw new Error(`Errore caricamento eventi (${res.status})`);
  return res.json();
}

export async function fetchCities(): Promise<string[]> {
  const res = await fetch("/api/events/cities");
  if (!res.ok) throw new Error("Errore caricamento comuni");
  const data = (await res.json()) as { cities: string[] };
  return data.cities;
}

export async function toggleSaved(event: MiEvent): Promise<MiEvent> {
  const res = await fetch(`/api/events/${event.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ saved: !event.saved }),
  });
  if (!res.ok) throw new Error("Errore salvataggio");
  return res.json();
}
