import type { EventSource } from "../../../application/ports.js";
import type { EventDraft, SourceResult } from "../../../core/types.js";
import { parsePriceText } from "../../../core/price.js";
import { MI_CITY_RE, stripHtml } from "../../../core/text.js";
import { getText } from "./http.js";

const LISTING = "https://radiopunk.it/evento/";
const ROW_RE = /(\d{2})\/(\d{2})\/(\d{4})(?:\s+\+\s*info)?\s+([^📍\n]{3,150}?)\s*📍\s*([A-Za-zÀ-ÿ .'-]+?)\s+@([^📍]+?)(?=\s+\d{2}\/\d{2}\/\d{4}|\s*🔗|\s*$)/g;

export const radiopunkSource: EventSource = {
  id: "radiopunk",
  async run(ctx): Promise<SourceResult> {
    const maxRows = ctx.limits["radiopunkDetails"] ?? 60;
    const events: EventDraft[] = [];
    let html: string;
    try {
      html = await getText(ctx.fetchImpl, LISTING);
    } catch {
      return { sourceId: this.id, events };
    }
    const text = stripHtml(html);
    for (const m of text.matchAll(ROW_RE)) {
      if (events.length >= maxRows) break;
      const start = `${m[3]}-${m[2]}-${m[1]}`;
      const title = m[4].trim();
      const city = m[5].trim().toUpperCase();
      const venue = m[6].trim().split(/\s{2,}/)[0];
      if (!MI_CITY_RE.test(city)) continue;
      if (start < ctx.fromDate || start > ctx.toDate) continue;
      const price = parsePriceText(text);
      events.push({
        sourceId: this.id,
        sourceName: "Radio Punk",
        title: title.slice(0, 300),
        description: null,
        start,
        end: null,
        timeStart: null,
        timeEnd: null,
        url: LISTING,
        venue: venue || null,
        address: null,
        city: city.startsWith("MILANO") ? "MILANO" : city,
        lat: null,
        lon: null,
        organizer: "Radio Punk",
        priceMin: price?.min ?? null,
        priceMax: price?.max ?? null,
      });
    }
    return { sourceId: this.id, events };
  },
};
