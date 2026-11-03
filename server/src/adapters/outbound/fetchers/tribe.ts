import type { EventSource, SourceContext } from "../../../application/ports.js";
import type { EventDraft, SourceResult } from "../../../core/types.js";
import { parseDateTime, stripHtml } from "../../../core/text.js";
import { parseCostField } from "../../../core/price.js";
import { getJson } from "./http.js";

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface TribeVenue {
  venue?: string;
  address?: string;
  city?: string;
  province?: string;
  zip?: string;
  country?: string;
}

interface TribeEvent {
  id: number;
  url: string;
  title: string;
  description?: string;
  excerpt?: string;
  start_date?: string;
  end_date?: string;
  all_day?: boolean;
  website?: string;
  cost?: string | null;
  venue?: TribeVenue | false;
  organizer?: { organizer?: string }[];
}

interface TribeResponse {
  events?: TribeEvent[];
  total?: number;
  total_pages?: number;
}

interface VenuePin {
  venue: string;
  address: string;
  city: string;
  lat: number;
  lon: number;
}

function tribeSource(opts: {
  baseUrl: string;
  sourceName: string;
  sourceId: string;
  pin?: VenuePin;
  lookbackDays?: number;
  defaultPages?: number;
}): EventSource {
  return {
    id: opts.sourceId,
    async run(ctx: SourceContext): Promise<SourceResult> {
      const lookback = opts.lookbackDays ?? 0;
      const maxPages = ctx.limits[`${opts.sourceId}Pages`] ?? opts.defaultPages ?? 3;
      const perPage = 100;
      const startDate = shiftDays(ctx.fromDate, -lookback);
      const events: EventDraft[] = [];
      const seen = new Set<string>();
      for (let page = 1; page <= maxPages; page++) {
        const url =
          `${opts.baseUrl}/wp-json/tribe/events/v1/events?per_page=${perPage}` +
          `&start_date=${encodeURIComponent(startDate)}` +
          (lookback > 0 ? "" : `&end_date=${encodeURIComponent(ctx.toDate)}`) +
          `&page=${page}`;
        let data: TribeResponse;
        try {
          data = (await getJson(ctx.fetchImpl, url)) as TribeResponse;
        } catch {
          break;
        }
        const rows = Array.isArray(data.events) ? data.events : [];
        if (rows.length === 0) break;
        for (const ev of rows) {
          const draft = toDraft(ev, opts);
          if (!draft) continue;
          if (opts.pin) {
            draft.venue = opts.pin.venue;
            draft.address = opts.pin.address;
            draft.city = opts.pin.city;
            draft.lat = opts.pin.lat;
            draft.lon = opts.pin.lon;
          }
          if (lookback > 0) {
            const end = draft.end ?? draft.start;
            if (end < ctx.fromDate || draft.start > ctx.toDate) continue;
          } else if (draft.start < ctx.fromDate || draft.start > ctx.toDate) {
            continue;
          }
          if (seen.has(draft.url)) continue;
          seen.add(draft.url);
          events.push(draft);
        }
        const totalPages = data.total_pages ?? 1;
        if (page >= totalPages || rows.length === 0) break;
        if (rows.every((r) => {
          const s = parseDateTime(r.start_date);
          return s !== null && s.date > ctx.toDate;
        })) break;
      }
      return { sourceId: opts.sourceId, events };
    },
  };
}

function toDraft(ev: TribeEvent, opts: { sourceName: string; sourceId: string }): EventDraft | null {
  const start = parseDateTime(ev.start_date);
  if (!ev.title || !ev.url || !start) return null;
  const end = parseDateTime(ev.end_date);
  const venue = ev.venue || null;
  const city = venue?.city?.trim() || "MILANO";
  const addressParts = [venue?.address, venue?.zip, venue?.city, venue?.province].filter(Boolean);
  const price = parseCostField(ev.cost);
  return {
    sourceId: opts.sourceId,
    sourceName: opts.sourceName,
    title: stripHtml(ev.title).slice(0, 300),
    description: stripHtml(`${ev.description ?? ""} ${ev.excerpt ?? ""}`).slice(0, 1000) || null,
    start: start.date,
    end: end && end.date >= start.date ? end.date : start.date,
    timeStart: ev.all_day ? null : start.time,
    timeEnd: ev.all_day ? null : end?.time ?? null,
    url: ev.url,
    venue: venue?.venue?.trim() || opts.sourceName,
    address: addressParts.length > 0 ? addressParts.join(", ") : null,
    city: city.toUpperCase(),
    lat: null,
    lon: null,
    organizer: ev.organizer?.[0]?.organizer ?? opts.sourceName,
    priceMin: price?.min ?? null,
    priceMax: price?.max ?? null,
  };
}

export const tribeBaseSource = tribeSource({
  baseUrl: "https://base.milano.it",
  sourceName: "BASE Milano",
  sourceId: "tribe-base",
  pin: {
    venue: "BASE Milano",
    address: "Via Tortona 40, 20144 Milano",
    city: "MILANO",
    lat: 45.4509,
    lon: 9.1587,
  },
});

export const tribeMagazziniSource = tribeSource({
  baseUrl: "https://www.magazzinigenerali.org",
  sourceName: "Magazzini Generali",
  sourceId: "tribe-magazzini",
});

export const tribeEventiAtMilanoSource = tribeSource({
  baseUrl: "https://www.eventiatmilano.it",
  sourceName: "Eventi@Milano",
  sourceId: "tribe-eventiatmilano",
  lookbackDays: 180,
  defaultPages: 10,
});

export const tribeSources: EventSource[] = [tribeBaseSource, tribeMagazziniSource, tribeEventiAtMilanoSource];
