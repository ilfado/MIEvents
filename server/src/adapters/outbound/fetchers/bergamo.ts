import type { EventSource, SourceContext } from "../../../application/ports.js";
import type { EventDraft, SourceResult } from "../../../core/types.js";
import { parseIcs } from "../../../core/ics.js";
import { parsePriceText } from "../../../core/price.js";
import { stripHtml } from "../../../core/text.js";
import { getText } from "./http.js";

const ICAL_URL = "https://www.eventi.bergamo.it/calendario/?ical=1";
// province entro ~100 km da Milano
const AREA_PROV_RE = /(?:^|[\s,(])(MI|MB|BG|BS|CR|CO|VA|LC)(?:[\s,).]|$)/i;

function splitLocation(loc: string): { venue: string | null; address: string | null; city: string } {
  const parts = loc.split(",").map((s) => s.trim()).filter(Boolean);
  const venue = parts[0] || null;
  const address = parts.slice(1).join(", ") || null;
  const prov = loc.match(AREA_PROV_RE);
  const cityMatch = loc.match(/\d{5}\s+([A-Za-zÀ-ÿ' ]+?)\s+[A-Z]{2}\b/);
  return { venue, address, city: (cityMatch?.[1] ?? parts[0] ?? "").toUpperCase() || (prov ? prov[1].toUpperCase() : "") };
}

export const bergamoSource: EventSource = {
  id: "vivere-bergamo",
  async run(ctx: SourceContext): Promise<SourceResult> {
    let text: string;
    try {
      text = await getText(ctx.fetchImpl, ICAL_URL);
    } catch {
      return { sourceId: this.id, events: [] };
    }
    const events: EventDraft[] = [];
    for (const ev of parseIcs(text)) {
      if (!ev.dtstart || !ev.summary) continue;
      if (ev.dtstart < ctx.fromDate || ev.dtstart > ctx.toDate) continue;
      if (ev.location && !AREA_PROV_RE.test(ev.location) && !/bergamo|brescia|cremona|monza|varese|como|lecco|lombardia/i.test(ev.location)) continue;
      const { venue, address, city } = splitLocation(ev.location);
      const desc = stripHtml(ev.description);
      const price = parsePriceText(desc);
      events.push({
        sourceId: this.id,
        sourceName: "Vivere Bergamo",
        title: ev.summary.slice(0, 300),
        description: desc.slice(0, 1000) || null,
        start: ev.dtstart,
        end: ev.dtend,
        timeStart: ev.dtstartTime,
        timeEnd: ev.dtendTime,
        url: ev.url || ICAL_URL,
        venue,
        address,
        city: city || "BERGAMO",
        lat: null,
        lon: null,
        organizer: "Vivere Bergamo",
        _id: ev.uid || undefined,
        priceMin: price?.min ?? null,
        priceMax: price?.max ?? null,
      });
    }
    return { sourceId: this.id, events };
  },
};
