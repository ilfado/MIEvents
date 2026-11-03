import type { EventSource, SourceContext } from "../../../application/ports.js";
import type { SourceResult } from "../../../core/types.js";
import { parseRssItems } from "../../../core/rss.js";
import { extractDateFromText } from "../../../core/text.js";
import { getText } from "./http.js";

const EVENT_RE =
  /\b(concerto|concerti|live|dj set|djset|festival|show|mostra|esposizione|spettacolo|teatro|musical|sagra|fiera|mercato|rassegna|inaugurazione|proiezione|lezione|incontro|workshop|laboratorio|evento|appuntamento|manifestazione|visita guidata|stand-up|comedy|dj)\b/i;
const VENUE_HINT_RE =
  /\b(alcatraz|fabrique|santeria|magnolia|carroponte|legend|blue note|base milano|magazzini generali|elfo|arcimboldi|carcano|franco parenti|menotti|out off|zona k|fabbrica del vapore|hangarbicocca|triennale|castello sforzesco|sforzesco|unipol|forum|dome|san siro|idroscalo|leoncavallo|biko|slaughter)\b/i;
const MI_AREA_RE =
  /\b(milano|monza|brianza|sesto|segrate|cinisello|rho|pero|assago|rozzano|san donato|melegnano|abbiategrasso|cernusco|gorgonzola|pioltello|cesano|corsico|binasco|cusago|paderno|senago|legnano|busto|castellanza|parabiago|novate|garbagnate|laina|limbiate|arese|baranzate|bollate|cesate|inzago|trezzano|magenta|corbetta|sedriano|vittuone|lombardia|MI)\b/i;

function newsRssSource(opts: { feedUrl: string; sourceId: string; sourceName: string }): EventSource {
  return {
    id: opts.sourceId,
    async run(ctx: SourceContext): Promise<SourceResult> {
      const maxItems = ctx.limits[`${opts.sourceId}Max`] ?? 20;
      const xml = await getText(ctx.fetchImpl, opts.feedUrl, "application/rss+xml, application/xml, text/xml, */*");
      const events: SourceResult["events"] = [];
      const seen = new Set<string>();
      for (const item of parseRssItems(xml)) {
        if (events.length >= maxItems) break;
        const text = `${item.title} ${item.description}`;
        const venueHit = VENUE_HINT_RE.test(text) || VENUE_HINT_RE.test(item.link);
        if (!EVENT_RE.test(text) && !venueHit) continue;
        if (!MI_AREA_RE.test(text) && !MI_AREA_RE.test(item.link) && !venueHit) continue;
        const fromText = extractDateFromText(text);
        const pubDate = item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : null;
        const start = fromText ?? null;
        if (start) {
          if (start < ctx.fromDate || start > ctx.toDate) continue;
        } else if (!pubDate || pubDate > ctx.toDate) {
          continue;
        }
        const eventStart = (start ?? pubDate) as string;
        if (seen.has(item.link)) continue;
        seen.add(item.link);
        events.push({
          sourceId: opts.sourceId,
          sourceName: opts.sourceName,
          title: item.title.slice(0, 300),
          description: item.description.slice(0, 1000) || null,
          start: eventStart,
          end: null,
          timeStart: null,
          timeEnd: null,
          url: item.link,
          venue: null,
          address: null,
          city: "MILANO",
          lat: null,
          lon: null,
          organizer: opts.sourceName,
        });
      }
      return { sourceId: opts.sourceId, events };
    },
  };
}

export const newsRssSources: EventSource[] = [
  newsRssSource({
    feedUrl: "https://vivimilano.corriere.it/concerti-e-spettacoli/feed/",
    sourceId: "vivimilano-spettacoli",
    sourceName: "ViviMilano Spettacoli",
  }),
  newsRssSource({
    feedUrl: "https://milanoevents.it/category/eventi-milano/feed/",
    sourceId: "milanoevents",
    sourceName: "MilanoEvents.it",
  }),
  newsRssSource({
    feedUrl: "https://www.eventiatmilano.it/feed/",
    sourceId: "eventiatmilano-concerti",
    sourceName: "Eventi@Milano",
  }),
];
