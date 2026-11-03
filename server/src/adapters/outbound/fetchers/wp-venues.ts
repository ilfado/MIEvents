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
      const url = `${opts.baseUrl}/wp-json/wp/v2/${opts.restPath}?per_page=100&_fields=id,link,title,content,excerpt,date,all_meta,class_list`;
      const items = (await getJson(ctx.fetchImpl, url)) as Array<WpItem & { all_meta?: Record<string, string[]>; class_list?: string[] }>;
      const events: SourceResult["events"] = [];
      for (const item of (Array.isArray(items) ? items : []).slice(0, maxItems)) {
        const title = stripHtml(item.title?.rendered ?? "");
        const body = stripHtml(`${item.content?.rendered ?? ""} ${item.excerpt?.rendered ?? ""}`);
        const locClass = (item.class_list ?? []).find((c) => c.startsWith("location-"));
        const venueHint = locClass ? locClass.replace("location-", "").replace(/-/g, " ") : null;
        const metaStart = item.all_meta?.data_inizio?.[0] ?? item.all_meta?.data_libera?.[0] ?? null;
        const metaEnd = item.all_meta?.data_fine?.[0] ?? null;
        const start = (metaStart && /^\d{4}-\d{2}-\d{2}/.test(metaStart) ? metaStart.slice(0, 10) : null)
          ?? extractDateFromText(metaStart ?? "")
          ?? extractDateFromText(body)
          ?? extractDateFromText(item.link);
        const end = (metaEnd && /^\d{4}-\d{2}-\d{2}/.test(metaEnd) ? metaEnd.slice(0, 10) : null) ?? null;
        if (!title || !start || start < ctx.fromDate || start > ctx.toDate) continue;
        events.push({
          sourceId: opts.sourceId,
          sourceName: opts.sourceName,
          title: title.slice(0, 300),
          description: body.slice(0, 1000) || null,
          start,
          end,
          timeStart: null,
          timeEnd: null,
          url: item.link,
          venue: venueHint ? `${opts.sourceName} ${venueHint}` : opts.sourceName,
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

