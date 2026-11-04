import type { EventSource } from "../../../application/ports.js";
import type { SourceResult } from "../../../core/types.js";
import { extractJsonLdEvents, ldToDraft } from "../../../core/jsonld.js";
import { inMilanoProvince } from "../../../core/text.js";
import { getText, sleep } from "./http.js";

const LISTINGS = [
  "https://www.cheventi.it/regioni/lombardia/milano/",
  "https://www.cheventi.it/regioni/lombardia/",
];

export const cheventiSource: EventSource = {
  id: "cheventi",
  async run(ctx): Promise<SourceResult> {
    const maxPages = ctx.limits["cheventiPages"] ?? 2;
    const delay = 800;
    const events: SourceResult["events"] = [];
    const seen = new Set<string>();
    for (const base of LISTINGS) {
      for (let page = 1; page <= maxPages; page++) {
        const url = page === 1 ? base : `${base}page/${page}/`;
        let html: string;
        try {
          html = await getText(ctx.fetchImpl, url);
        } catch {
          break;
        }
        let added = 0;
        for (const ev of extractJsonLdEvents(html)) {
          const draft = ldToDraft(ev, this.id, "Cheventi.it");
          if (!draft || !draft.url) continue;
          if (/candlelight/i.test(draft.title)) continue;
          if (draft.start < ctx.fromDate || draft.start > ctx.toDate) continue;
          if (draft.lat !== null && draft.lon !== null && !inMilanoProvince(draft.lat, draft.lon)) continue;
          if (seen.has(draft.url)) continue;
          seen.add(draft.url);
          events.push(draft);
          added++;
        }
        if (added === 0) break;
        if (delay > 0) await sleep(delay);
      }
    }
    return { sourceId: this.id, events };
  },
};
