import type { EventSource, SourceContext } from "../../../application/ports.js";
import type { EventDraft, SourceResult } from "../../../core/types.js";
import { parseCostField, parsePriceText } from "../../../core/price.js";
import { extractDateFromText, parseDateTime, stripHtml } from "../../../core/text.js";
import { pinForVenue } from "../../../core/venue-pins.js";
import { getJson, sleep } from "./http.js";

interface WpItem {
  id: number;
  link: string;
  title?: { rendered: string };
  content?: { rendered: string };
  excerpt?: { rendered: string };
  acf?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

function firstDate(item: WpItem): string | null {
  const acf = item.acf ?? {};
  const meta = item.meta ?? {};
  const candidates = [
    acf.date, acf.start_date, acf.data, acf.data_evento, acf.event_date,
    meta._EventStartDate, meta._event_start_date, meta.date,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c) {
      const p = parseDateTime(c);
      if (p) return p.date;
    }
  }
  const text = stripHtml(`${item.content?.rendered ?? ""} ${item.excerpt?.rendered ?? ""}`);
  return extractDateFromText(text);
}

function wpCptSource(opts: { baseUrl: string; cpt: string; sourceId: string; sourceName: string; venue: string }): EventSource {
  return {
    id: opts.sourceId,
    async run(ctx: SourceContext): Promise<SourceResult> {
      const maxPages = ctx.limits[`${opts.sourceId}Pages`] ?? 3;
      const delay = 600;
      const pin = pinForVenue(opts.venue, null);
      const events: EventDraft[] = [];
      const seen = new Set<string>();
      for (let page = 1; page <= maxPages; page++) {
        const url = `${opts.baseUrl}/wp-json/wp/v2/${opts.cpt}?per_page=100&page=${page}&_fields=id,link,title,content,excerpt,acf,meta`;
        let items: WpItem[];
        try {
          const data = await getJson(ctx.fetchImpl, url);
          if (!Array.isArray(data)) break;
          items = data;
        } catch {
          break;
        }
        if (items.length === 0) break;
        for (const item of items) {
          const title = stripHtml(item.title?.rendered ?? "");
          if (!title || !item.link || seen.has(item.link)) continue;
          seen.add(item.link);
          const acf = item.acf ?? {};
          if (acf.canceled === true || acf.sold_out === true || acf.canceled === "1" || acf.sold_out === "1") continue;
          const start = firstDate(item);
          if (!start || start < ctx.fromDate || start > ctx.toDate) continue;
          const text = stripHtml(`${item.content?.rendered ?? ""} ${item.excerpt?.rendered ?? ""}`);
          const price = parseCostField(typeof acf.price === "string" ? acf.price : null) ?? parsePriceText(text);
          if (price && price.max >= 35) continue;
          events.push({
            sourceId: opts.sourceId,
            sourceName: opts.sourceName,
            title: title.slice(0, 300),
            description: text.slice(0, 1000) || null,
            start,
            end: null,
            timeStart: typeof acf.starts_at === "string" ? acf.starts_at.slice(0, 5) : null,
            timeEnd: null,
            url: item.link,
            venue: opts.venue,
            address: pin?.address ?? null,
            city: pin?.city ?? "MILANO",
            lat: pin?.lat ?? null,
            lon: pin?.lon ?? null,
            organizer: opts.sourceName,
            categoryHint: "concerto",
            priceMin: price?.min ?? null,
            priceMax: price?.max ?? null,
          });
        }
        if (items.length < 100) break;
        if (delay > 0) await sleep(delay);
      }
      return { sourceId: opts.sourceId, events };
    },
  };
}

export const alcatrazSource = wpCptSource({
  baseUrl: "https://www.alcatrazmilano.it",
  cpt: "events",
  sourceId: "wp-alcatraz",
  sourceName: "Alcatraz Milano",
  venue: "Alcatraz",
});

export const magnoliaSource = wpCptSource({
  baseUrl: "https://circolomagnolia.it",
  cpt: "event_listing",
  sourceId: "wp-magnolia",
  sourceName: "Circolo Magnolia",
  venue: "Circolo Magnolia",
});
