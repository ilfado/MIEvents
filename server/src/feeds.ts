import { createHash } from "node:crypto";
import type { MiEvent } from "@mievents/shared";
import { categorize } from "./normalize.js";

export interface FeedSource {
  id: string;
  name: string;
  url: string;
  kind: "rss" | "jsonld";
}

export const FEED_SOURCES: FeedSource[] = [
  { id: "milanotoday-rss", name: "MilanoToday", url: "https://www.milanotoday.it/rss/", kind: "rss" },
  { id: "ilgiorno-rss", name: "Il Giorno", url: "https://www.ilgiorno.it/rss/", kind: "rss" },
  { id: "arci-rss", name: "Arci", url: "https://www.arci.it/feed/", kind: "rss" },
  { id: "milanotoday-events", name: "MilanoToday Eventi", url: "https://www.milanotoday.it/eventi/location/milano/", kind: "jsonld" },
];

const EVENT_KEYWORDS =
  /\b(evento|eventi|concerto|concerti|mostra|mostre|spettacolo|teatro|festival|sagra|fiera|mercato|mercato di|rassegna|rassegna|appuntamento|appuntamenti|programma|weekend|cosa fare|ingresso libero|gratis|dj set|live|inaugurazione|visita guidata|lezione|incontro|conferenza|proiezione|laboratorio|workshop|expo|manifestazione|corteо|corteo|sit-in|presidio)\b/i;

const MILANO_HINT = /\b(milano|monza|bovisa|brera|navigli|duomo|centro storico|sesto san giovanni|cinisello balsamo|rho|però|pero|monza|cinisello|segrate|san donato|melegnano|rozzano|abbiategrasso|assago|binasco|cesano boscone|corsico|cusago|cesano maderno|paderno dugnano|senago|gorgonzola|cernusco|pioltello|rodano|vignate|settala|vaprio|pozzuolo|trezzo|trezzano|abbiategrasso|motta visconti|morimondo|bernate ticino|boffalora|cerro al lambro|colturano|dresano|loccit|melegnano|san vittore olona|arese|bareggio|baranzate|bollate|cesate|cinisello|garbagnate|laina|limbiate|novate milanese|inzago|arese|mi|lombardia)\b/i;

const DATE_PATTERNS = [
  /(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/gi,
  /(\d{4})-(\d{2})-(\d{2})/g,
  /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/g,
];

const MONTHS: Record<string, string> = {
  gennaio: "01", febbraio: "02", marzo: "03", aprile: "04", maggio: "05", giugno: "06",
  luglio: "07", agosto: "08", settembre: "09", ottobre: "10", novembre: "11", dicembre: "12",
};

export function extractFirstDate(text: string): string | null {
  for (const re of DATE_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (!m) continue;
    if (m[0].includes("-") && m[1].length === 4) return `${m[1]}-${m[2]}-${m[3]}`;
    if (m[0].includes("/") || m[0].includes("-")) {
      return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    const month = MONTHS[m[2].toLowerCase()];
    if (month) return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeEvent(title: string, text: string): boolean {
  return EVENT_KEYWORDS.test(title) || EVENT_KEYWORDS.test(text.slice(0, 400));
}

function milanArea(text: string): boolean {
  return MILANO_HINT.test(text);
}

export interface RawFeedItem {
  title: string;
  link: string;
  description: string;
  pubDate: string | null;
  guid: string;
}

export function parseRss(xml: string): RawFeedItem[] {
  const items: RawFeedItem[] = [];
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const body = m[1];
    const pick = (tag: string): string => {
      const mm = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      if (!mm) return "";
      return mm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
    };
    const title = stripHtml(pick("title"));
    const link = pick("link");
    const description = stripHtml(pick("description")) || stripHtml(pick("encoded"));
    const pubDate = pick("pubDate") || pick("date") || null;
    const guid = pick("guid") || link;
    if (title && link) items.push({ title, link, description, pubDate, guid });
  }
  if (items.length === 0) {
    const entryRe = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    while ((m = entryRe.exec(xml)) !== null) {
      const body = m[1];
      const pick = (tag: string): string => {
        const mm = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
        return mm ? mm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
      };
      const title = stripHtml(pick("title"));
      let link = pick("link");
      const linkM = body.match(/<link[^>]*href="([^"]+)"/i);
      if (linkM) link = linkM[1];
      const description = stripHtml(pick("summary")) || stripHtml(pick("content"));
      const pubDate = pick("published") || pick("updated") || null;
      const guid = pick("id") || link;
      if (title && link) items.push({ title, link, description, pubDate, guid });
    }
  }
  return items;
}

export interface JsonLdEvent {
  name?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  description?: string;
  location?: { name?: string; address?: string | { addressLocality?: string; streetAddress?: string } } | string;
}

export function parseJsonLdEvents(html: string, pageUrl: string): RawFeedItem[] {
  const out: RawFeedItem[] = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const nodes = Array.isArray(data) ? data : [data];
    for (const node of nodes) {
      const items = Array.isArray(node) ? node : [node];
      for (const n of items) {
        const ev = n as JsonLdEvent & { "@type"?: string | string[] };
        const types = Array.isArray(ev["@type"]) ? ev["@type"] : [ev["@type"]];
        if (!types.includes("Event") || !ev.name) continue;
        const loc = typeof ev.location === "object" && ev.location !== null ? ev.location : {};
        const addr =
          typeof ev.location === "string"
            ? ev.location
            : [loc.name, typeof loc.address === "string" ? loc.address : loc.address?.streetAddress, loc.address && typeof loc.address === "object" ? loc.address.addressLocality : undefined]
                .filter(Boolean)
                .join(", ");
        const text = [ev.name, stripHtml(ev.description ?? ""), addr].join(" ");
        if (!looksLikeEvent(ev.name, text) || !milanArea(text + " " + pageUrl)) continue;
        out.push({
          title: ev.name,
          link: ev.url ?? pageUrl,
          description: stripHtml(ev.description ?? ""),
          pubDate: ev.startDate ?? null,
          guid: `${pageUrl}#${ev.name}`,
        });
      }
    }
  }
  return out;
}

export function feedItemToEvent(item: RawFeedItem, source: FeedSource, fetchedAt: string): MiEvent | null {
  const text = `${item.title} ${item.description}`;
  if (!looksLikeEvent(item.title, text)) return null;
  if (!milanArea(text) && !milanArea(item.link)) return null;
  const date = extractFirstDate(`${item.title} ${item.description}`) ?? (item.pubDate ? item.pubDate.slice(0, 10) : null);
  if (!date) return null;
  const id = createHash("sha1").update(`${source.id}|${item.guid}`).digest("hex").slice(0, 16);
  const city = (text.match(/\b([A-Z][A-Za-zÀ-ù' ]{2,20})\b(?:,|\s+-\s|\s+MI\b)/) || [])[1]?.toUpperCase() ?? "MILANO";
  return {
    id,
    title: item.title.slice(0, 300),
    description: item.description ? item.description.slice(0, 1000) : null,
    category: categorize(text),
    type: source.name,
    start: date,
    end: date,
    timeStart: null,
    timeEnd: null,
    venue: null,
    address: null,
    city,
    province: "MI",
    cap: null,
    organizer: source.name,
    website: null,
    programUrl: item.link,
    source: source.name,
    sourceUrl: item.link || source.url,
    lat: null,
    lon: null,
    saved: false,
    fetchedAt,
  };
}

export async function fetchFeed(
  source: FeedSource,
  fetchImpl: typeof fetch,
  ua: string,
): Promise<MiEvent[]> {
  const res = await fetchImpl(source.url, {
    headers: { "User-Agent": ua, Accept: "application/rss+xml, application/xml, text/xml, text/html, */*" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${source.name}: HTTP ${res.status}`);
  const body = await res.text();
  const items = source.kind === "rss" ? parseRss(body) : parseJsonLdEvents(body, source.url);
  const fetchedAt = new Date().toISOString();
  const events: MiEvent[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const e = feedItemToEvent(item, source, fetchedAt);
    if (e && !seen.has(e.id)) {
      seen.add(e.id);
      events.push(e);
    }
  }
  return events;
}
