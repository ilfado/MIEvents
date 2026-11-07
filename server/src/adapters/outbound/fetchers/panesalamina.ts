import type { EventSource, SourceContext } from "../../../application/ports.js";
import type { EventDraft, SourceResult } from "../../../core/types.js";
import { parsePriceText } from "../../../core/price.js";
import { distKm, extractDateFromText, isMiArea, MILANO_CENTER, parseDateTime, stripHtml } from "../../../core/text.js";
import { getJson, sleep } from "./http.js";

const BASE = "https://www.panesalamina.com";
const MAX_PAGES = 4;
const DELAY = 600;

interface Feast {
  id: number;
  link: string;
  title?: { rendered: string };
  excerpt?: { rendered: string };
  content?: { rendered: string };
  acf?: {
    evento_annullato?: boolean | string;
    days?: { day?: string }[];
    address?: { address?: string; lat?: number; lng?: number; city?: string; name?: string };
    enter?: string;
  };
}

function dayToIso(day: string | undefined): string | null {
  if (!day) return null;
  const m = day.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const p = parseDateTime(`${m[1]}-${m[2]}-${m[3]}`);
  return p ? p.date : null;
}

export const panesalaminaSource: EventSource = {
  id: "panesalamina",
  async run(ctx: SourceContext): Promise<SourceResult> {
    const events: EventDraft[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      let items: Feast[];
      try {
        const data = await getJson(
          ctx.fetchImpl,
          `${BASE}/wp-json/wp/v2/feast?per_page=100&page=${page}&_fields=id,link,title,excerpt,content,acf`,
        );
        if (!Array.isArray(data)) break;
        items = data;
      } catch {
        break;
      }
      if (items.length === 0) break;
      for (const f of items) {
        if (seen.has(f.link)) continue;
        seen.add(f.link);
        const acf = f.acf ?? {};
        if (acf.evento_annullato === true || acf.evento_annullato === "1") continue;
        const days = (acf.days ?? []).map((d) => dayToIso(d.day)).filter((d): d is string => !!d).sort();
        if (days.length === 0) {
          const text = stripHtml(`${f.excerpt?.rendered ?? ""} ${f.content?.rendered ?? ""}`);
          const d = extractDateFromText(text);
          if (d) days.push(d);
        }
        if (days.length === 0) continue;
        const start = days[0];
        const end = days.length > 1 ? days[days.length - 1] : null;
        if (start < ctx.fromDate || start > ctx.toDate) continue;
        const addr = acf.address ?? {};
        const lat = typeof addr.lat === "number" && Number.isFinite(addr.lat) ? addr.lat : null;
        const lon = typeof addr.lng === "number" && Number.isFinite(addr.lng) ? addr.lng : null;
        const address = addr.address ?? null;
        const city = (addr.city ?? addr.name ?? "").toUpperCase();
        if (lat != null && lon != null) {
          if (distKm(lat, lon, MILANO_CENTER.lat, MILANO_CENTER.lon) > 100) continue;
        } else if (!isMiArea(`${addr.name ?? ""} ${address ?? ""} ${city}`)) continue;
        const title = stripHtml(f.title?.rendered ?? "");
        if (!title) continue;
        const text = stripHtml(`${f.excerpt?.rendered ?? ""} ${f.content?.rendered ?? ""}`);
        const price = parsePriceText(`${typeof acf.enter === "string" ? acf.enter : ""} ${text}`);
        events.push({
          sourceId: this.id,
          sourceName: "PaneSalamina",
          title: title.slice(0, 300),
          description: text.slice(0, 1000) || null,
          start,
          end,
          timeStart: null,
          timeEnd: null,
          url: f.link,
          venue: addr.name ?? null,
          address,
          city: city || "MILANO",
          lat,
          lon,
          organizer: "PaneSalamina",
          categoryHint: "sagra",
          priceMin: price?.min ?? null,
          priceMax: price?.max ?? null,
        });
      }
      if (items.length < 100) break;
      if (DELAY > 0) await sleep(DELAY);
    }
    return { sourceId: this.id, events };
  },
};
