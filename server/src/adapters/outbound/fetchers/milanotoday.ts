import type { EventSource } from "../../../application/ports.js";
import type { SourceResult } from "../../../core/types.js";
import { extractJsonLdEvents, ldToDraft } from "../../../core/jsonld.js";
import { extractLinks, todayIso } from "../../../core/text.js";
import { getText, sleep } from "./http.js";

const EVENT_PATH = /\/eventi\/[a-z0-9][a-z0-9-]*\.html$/i;

export function milanotodayRangeUrl(from: string, to: string): string {
  return `https://www.milanotoday.it/eventi/dal/${from}/al/${to}/`;
}

export const milanotodaySource: EventSource = {
  id: "milanotoday-eventi",
  async run(ctx): Promise<SourceResult> {
    const maxPages = ctx.limits["milanotodayPages"] ?? 1;
    const maxDetails = ctx.limits["milanotodayDetails"] ?? 40;
    const delay = 700;
    const from = ctx.fromDate;
    const to = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const detailUrls: string[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1 ? milanotodayRangeUrl(from, to) : `${milanotodayRangeUrl(from, to)}?page=${page}`;
      const html = await getText(ctx.fetchImpl, url);
      const found = extractLinks(html, url, EVENT_PATH);
      for (const u of found) if (!detailUrls.includes(u)) detailUrls.push(u);
      if (found.length === 0) break;
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
          if (draft.start < from) continue;
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

export const unusedTodayIso = todayIso;
