import { extractMiCity, stripHtml, parseDateTime, safeUrl } from "./text.js";
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
  const vals: number[] = [];
  for (const o of offers) {
    if (!o || typeof o !== "object") continue;
    const rec = o as Record<string, unknown>;
    const low = toNum(rec.lowPrice ?? rec.price);
    const high = toNum(rec.highPrice ?? rec.price);
    if (low != null) vals.push(low);
    if (high != null && high !== low) vals.push(high);
  }
  if (vals.length === 0) return null;
  const top = Math.max(...vals);
  const kept = top >= 10 ? vals.filter((v) => v >= 5) : vals;
  const lo = Math.min(...kept);
  const hi = Math.max(...kept);
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
  let city = "";
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
  if (!city) {
    const addrText = [typeof ev.location === "string" ? ev.location : loc?.name, address].filter(Boolean).join(" ");
    city = extractMiCity(addrText);
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
