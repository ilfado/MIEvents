import type { EventSource } from "../../../application/ports.js";
import type { EventDraft, SourceResult } from "../../../core/types.js";
import { parsePriceText } from "../../../core/price.js";
import { extractLinks, MI_CITY_RE, stripHtml } from "../../../core/text.js";
import { getText, sleep } from "./http.js";

const LISTING = "https://radiopunk.it/evento/";
const EVENT_LINK = /\/evento\/\?event=\d+/i;
const ROW_RE = /(\d{2})\/(\d{2})\/(\d{4})\s+([^📍\n]{3,150}?)\s*📍\s*([A-Za-zÀ-ÿ .'-]+?)\s+@([^\n]+)/;

export const radiopunkSource: EventSource = {
  id: "radiopunk",
  async run(ctx): Promise<SourceResult> {
    const maxDetails = ctx.limits["radiopunkDetails"] ?? 40;
    const delay = 700;
    const events: EventDraft[] = [];
    const seen = new Set<string>();
    let html: string;
    try {
      html = await getText(ctx.fetchImpl, LISTING);
    } catch {
      return { sourceId: this.id, events };
    }
    const links = extractLinks(html, LISTING, EVENT_LINK);
    let count = 0;
    for (const link of links) {
      if (count >= maxDetails) break;
      if (seen.has(link)) continue;
      seen.add(link);
      try {
        const detail = await getText(ctx.fetchImpl, link);
        const text = stripHtml(detail);
        const m = text.match(ROW_RE);
        if (!m) continue;
        const start = `${m[3]}-${m[2]}-${m[1]}`;
        const title = m[4].trim();
        const city = m[5].trim().toUpperCase();
        const venue = m[6].trim();
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
          url: link,
          venue: venue || null,
          address: null,
          city: city.startsWith("MILANO") ? "MILANO" : city,
          lat: null,
          lon: null,
          organizer: "Radio Punk",
          priceMin: price?.min ?? null,
          priceMax: price?.max ?? null,
        });
        count++;
        if (delay > 0 && count < maxDetails) await sleep(delay);
      } catch {
        continue;
      }
    }
    return { sourceId: this.id, events };
  },
};
