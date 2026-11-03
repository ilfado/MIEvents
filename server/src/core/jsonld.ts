import { stripHtml, parseDateTime, safeUrl } from "./text.js";
import type { EventDraft } from "./types.js";
import type { ParsedPrice } from "./price.js";

export interface LdEvent {
  "@type"?: string | string[];
  name?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  description?: string;
  isAccessibleForFree?: boolean;
  offers?: unknown;
  location?:
    | string
    | {
        name?: string;
        address?:
          | string
          | {
              streetAddress?: string;
              addressLocality?: string;
              addressRegion?: string;
              postalCode?: string;
            };
        geo?: { latitude?: number | string; longitude?: number | string };
      };
}

export function allJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      continue;
    }
  }
  return out;
}

export function flattenLd(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((n) => flattenLd(n));
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    const parts: Record<string, unknown>[] = [o];
    if (o["@graph"]) parts.push(...flattenLd(o["@graph"]));
    if (o.itemListElement) parts.push(...flattenLd(o.itemListElement));
    if (o.item && typeof o.item === "object") parts.push(o.item as Record<string, unknown>);
    return parts;
  }
  return [];
}

export function extractJsonLdEvents(html: string): LdEvent[] {
  const events: LdEvent[] = [];
  for (const node of allJsonLd(html).flatMap(flattenLd)) {
    const ev = node as LdEvent;
    const types = Array.isArray(ev["@type"]) ? ev["@type"] : [ev["@type"]];
    if (types.includes("Event")) events.push(ev);
  }
  return events;
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : null;
}

export function ldPrice(ev: LdEvent): ParsedPrice | null {
  if (ev.isAccessibleForFree === true) return { min: 0, max: 0, free: true };
  const raw = ev.offers;
  const offers = Array.isArray(raw) ? raw : raw ? [raw] : [];
  let min: number | null = null;
  let max: number | null = null;
  for (const o of offers) {
    if (!o || typeof o !== "object") continue;
    const rec = o as Record<string, unknown>;
    const low = toNum(rec.lowPrice ?? rec.price);
    const high = toNum(rec.highPrice ?? rec.price);
    if (low == null && high == null) continue;
    min = min == null ? low : low == null ? min : Math.min(min, low);
    max = max == null ? high : high == null ? max : Math.max(max, high);
  }
  if (min == null && max == null) return null;
  const lo = min ?? max ?? 0;
  const hi = max ?? min ?? 0;
  if (lo === 0 && hi === 0) return { min: 0, max: 0, free: true };
  return { min: lo, max: hi, free: false };
}

export function ldToDraft(ev: LdEvent, sourceId: string, sourceName: string): EventDraft | null {
  const types = Array.isArray(ev["@type"]) ? ev["@type"] : [ev["@type"]];
  if (!types.includes("Event") || !ev.name) return null;
  const start = parseDateTime(ev.startDate);
  if (!start) return null;
  const end = parseDateTime(ev.endDate);
  const loc = typeof ev.location === "object" && ev.location !== null ? ev.location : null;
  let address: string | null = null;
  let city = "MILANO";
  let lat: number | null = null;
  let lon: number | null = null;
  if (typeof ev.location === "string") {
    address = ev.location;
  } else if (loc) {
    if (typeof loc.address === "string") {
      address = loc.address;
    } else if (loc.address) {
      address = [loc.address.streetAddress, loc.address.addressLocality].filter(Boolean).join(", ");
      if (loc.address.addressLocality) city = loc.address.addressLocality.toUpperCase();
    }
    if (loc.geo) {
      lat = Number(loc.geo.latitude);
      lon = Number(loc.geo.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        lat = null;
        lon = null;
      }
    }
  }
  const price = ldPrice(ev);
  return {
    sourceId,
    sourceName,
    title: stripHtml(ev.name).slice(0, 300),
    description: ev.description ? stripHtml(ev.description).slice(0, 1500) : null,
    start: start.date,
    end: end?.date ?? null,
    timeStart: start.time,
    timeEnd: end?.time ?? null,
    url: safeUrl(ev.url) ?? "",
    venue: loc?.name && loc.name !== "-" ? loc.name : null,
    address,
    city,
    lat,
    lon,
    organizer: null,
    priceMin: price?.min ?? null,
    priceMax: price?.max ?? null,
  };
}
