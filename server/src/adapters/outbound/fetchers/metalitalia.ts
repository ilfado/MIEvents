import type { EventSource } from "../../../application/ports.js";
import type { SourceResult } from "../../../core/types.js";
import { extractJsonLdEvents, ldToDraft } from "../../../core/jsonld.js";
import { distKm, extractLinks, inMilanoProvince, MI_CITY_RE, MILANO_CENTER } from "../../../core/text.js";
import { getText, sleep } from "./http.js";

const LISTING = "https://metalitalia.com/category/agenda/";
const EVENT_PATH = /\/evento\/[^/?#]+/i;

function inArea(d: { lat: number | null; lon: number | null; venue: string | null; address: string | null; city: string }): boolean {
  if (d.lat != null && d.lon != null) {
    if (!inMilanoProvince(d.lat, d.lon)) return false;
    return distKm(d.lat, d.lon, MILANO_CENTER.lat, MILANO_CENTER.lon) <= 50;
  }
  return MI_CITY_RE.test(`${d.venue ?? ""} ${d.address ?? ""} ${d.city}`);
}

export const metalitaliaSource: EventSource = {
  id: "metalitalia",
  async run(ctx): Promise<SourceResult> {
    const maxPages = ctx.limits["metalitaliaPages"] ?? 5;
    const maxDetails = ctx.limits["metalitaliaDetails"] ?? 40;
    const delay = 700;
    const seen = new Set<string>();
    const events: SourceResult["events"] = [];
    let count = 0;
    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1 ? LISTING : `${LISTING}page/${page}/`;
      let html: string;
      try {
        html = await getText(ctx.fetchImpl, url);
      } catch {
        break;
      }
      const links = extractLinks(html, LISTING, EVENT_PATH);
      if (links.length === 0) break;
      for (const link of links) {
        if (count >= maxDetails) break;
        if (seen.has(link)) continue;
        seen.add(link);
        try {
          const detail = await getText(ctx.fetchImpl, link);
          for (const ev of extractJsonLdEvents(detail)) {
            const draft = ldToDraft(ev, this.id, "Metalitalia");
            if (!draft) continue;
            if (!draft.url) draft.url = link;
            if (draft.start < ctx.fromDate || draft.start > ctx.toDate) continue;
            if (!inArea(draft)) continue;
            events.push(draft);
            count++;
          }
          if (delay > 0 && count < maxDetails) await sleep(delay);
        } catch {
          continue;
        }
      }
      if (count >= maxDetails) break;
    }
    return { sourceId: this.id, events };
  },
};
