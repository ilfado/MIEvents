import type { EventSource, SourceContext } from "../../../application/ports.js";
import type { SourceResult } from "../../../core/types.js";
import { extractDateFromText, stripHtml } from "../../../core/text.js";
import { getJson, sleep } from "./http.js";

interface WpItem {
  id: number;
  link: string;
  title?: { rendered: string };
  content?: { rendered: string };
  excerpt?: { rendered: string };
}

function wpVenueSource(opts: { baseUrl: string; sourceName: string; restPath: string; sourceId: string }): EventSource {
  return {
    id: opts.sourceId,
    async run(ctx: SourceContext): Promise<SourceResult> {
      const maxItems = ctx.limits[`${opts.sourceId}Max`] ?? 50;
      const delay = 700;
      const url = `${opts.baseUrl}/wp-json/wp/v2/${opts.restPath}?per_page=100&_fields=id,link,title,content,excerpt,date`;
      const items = (await getJson(ctx.fetchImpl, url)) as WpItem[];
      const events: SourceResult["events"] = [];
      for (const item of (Array.isArray(items) ? items : []).slice(0, maxItems)) {
        const title = stripHtml(item.title?.rendered ?? "");
        const body = stripHtml(`${item.content?.rendered ?? ""} ${item.excerpt?.rendered ?? ""}`);
        const start = extractDateFromText(body) ?? extractDateFromText(item.link);
        if (!title || !start || start < ctx.fromDate) continue;
        events.push({
          sourceId: opts.sourceId,
          sourceName: opts.sourceName,
          title: title.slice(0, 300),
          description: body.slice(0, 1000) || null,
          start,
          end: null,
          timeStart: null,
          timeEnd: null,
          url: item.link,
          venue: opts.sourceName,
          address: null,
          city: "MILANO",
          lat: null,
          lon: null,
          organizer: opts.sourceName,
        });
        if (delay > 0 && events.length < maxItems) await sleep(delay);
      }
      return { sourceId: opts.sourceId, events };
    },
  };
}

export const santeriaSource = wpVenueSource({
  baseUrl: "https://www.santeria.milano.it",
  sourceName: "Santeria Milano",
  restPath: "eventi",
  sourceId: "wp-santeria",
});

