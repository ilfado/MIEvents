import type { EventSource } from "../../../application/ports.js";
import type { SourceResult } from "../../../core/types.js";
import { extractJsonLdEvents, ldToDraft } from "../../../core/jsonld.js";
import { extractLinks, stripHtml } from "../../../core/text.js";
import { parsePriceText } from "../../../core/price.js";
import { getText, sleep } from "./http.js";

const EVENT_PATH = /\/eventi\/(?:[^/?#]+\/)*[^/?#]+\.html/i;
const RSS_CHANNEL = "https://www.milanotoday.it/rss/channels/eventi/";

export function milanotodayRangeUrl(from: string, to: string): string {
  return `https://www.milanotoday.it/eventi/dal/${from}/al/${to}/`;
}

export const milanotodaySource: EventSource = {
  id: "milanotoday-eventi",
  async run(ctx): Promise<SourceResult> {
    const maxPages = ctx.limits["milanotodayPages"] ?? 3;
    const maxDetails = ctx.limits["milanotodayDetails"] ?? 80;
    const delay = 700;
    const from = ctx.fromDate;
    const to = ctx.toDate;
    const detailUrls: string[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1 ? milanotodayRangeUrl(from, to) : `${milanotodayRangeUrl(from, to)}?page=${page}`;
      let html: string;
      try {
        html = await getText(ctx.fetchImpl, url);
      } catch {
        break;
      }
      const found = extractLinks(html, url, EVENT_PATH);
      for (const u of found) if (!detailUrls.includes(u)) detailUrls.push(u);
      if (found.length === 0) break;
    }
    try {
      const rss = await getText(ctx.fetchImpl, RSS_CHANNEL, "application/rss+xml, application/xml, text/xml, */*");
      for (const m of rss.matchAll(/<link>\s*([^<]+?)\s*<\/link>/g)) {
        const abs = m[1].startsWith("http") ? m[1] : new URL(m[1], RSS_CHANNEL).toString();
        if (EVENT_PATH.test(abs) && !detailUrls.includes(abs)) detailUrls.push(abs);
      }
    } catch {
      // canale RSS non raggiungibile: si prosegue con i link del listing
    }
    const events: SourceResult["events"] = [];
    const seen = new Set<string>();
    let count = 0;
    for (const url of detailUrls) {
      if (count >= maxDetails) break;
      try {
        const html = await getText(ctx.fetchImpl, url);
        for (const ev of extractJsonLdEvents(html)) {
          const draft = ldToDraft(ev, this.id, "MilanoToday Eventi");
          if (!draft || !draft.url) continue;
          if (draft.start < from || draft.start > ctx.toDate) continue;
          if (draft.priceMin == null && draft.priceMax == null) {
            const p = parsePriceText(stripHtml(html));
            if (p) {
              draft.priceMin = p.min;
              draft.priceMax = p.max;
            }
          }
          const key = `${draft.title}|${draft.start}`;
          if (seen.has(key)) continue;
          seen.add(key);
          events.push(draft);
          count++;
        }
        if (delay > 0 && count < detailUrls.length) await sleep(delay);
      } catch {
        continue;
      }
    }
    return { sourceId: this.id, events };
  },
};

