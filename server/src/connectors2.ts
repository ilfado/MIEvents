import { createHash } from "node:crypto";
import type { MiEvent } from "@mievents/shared";
import { categorize } from "./normalize.js";
import { venueId } from "./venues.js";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 MIEvents/0.1 (https://github.com/ilfado/MIEvents)";

export const MI_PROVINCE_BOUNDS = { south: 44.9, west: 8.4, north: 46.1, east: 10.6 };

export function inMilanoProvince(lat: number, lon: number): boolean {
  return lat >= MI_PROVINCE_BOUNDS.south && lat <= MI_PROVINCE_BOUNDS.north && lon >= MI_PROVINCE_BOUNDS.west && lon <= MI_PROVINCE_BOUNDS.east;
}

export interface ConnectorEvent {
  sourceId: string;
  sourceName: string;
  title: string;
  description: string | null;
  start: string;
  end: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  url: string;
  venue: string | null;
  address: string | null;
  city: string;
  lat: number | null;
  lon: number | null;
  organizer: string | null;
}

export function toMiEvent(e: ConnectorEvent, fetchedAt: string): MiEvent {
  const id = createHash("sha1").update(`${e.sourceId}|${e.url}|${e.start}`).digest("hex").slice(0, 16);
  const text = `${e.title} ${e.description ?? ""}`;
  return {
    id,
    title: e.title,
    description: e.description,
    category: categorize(text),
    type: e.sourceName,
    start: e.start,
    end: e.end ?? e.start,
    timeStart: e.timeStart,
    timeEnd: e.timeEnd,
    venue: e.venue,
    address: e.address,
    city: e.city,
    province: "MI",
    cap: null,
    organizer: e.organizer ?? e.sourceName,
    website: null,
    programUrl: e.url,
    source: e.sourceName,
    sourceUrl: e.url,
    lat: e.lat,
    lon: e.lon,
    saved: false,
    fetchedAt,
  };
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
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDateTime(value: string | null | undefined): { date: string; time: string | null } | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : null };
}

interface LdEvent {
  "@type"?: string | string[];
  name?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  description?: string;
  location?: {
    name?: string;
    address?:
      | string
      | {
          streetAddress?: string;
          addressLocality?: string;
          addressRegion?: string;
          postalCode?: string;
        };
    geo?: { latitude?: number | string; longitude?: number | string };
  } | string;
}

function ldToConnectorEvent(ev: LdEvent, sourceId: string, sourceName: string): ConnectorEvent | null {
  const types = Array.isArray(ev["@type"]) ? ev["@type"] : [ev["@type"]];
  if (!types.includes("Event") || !ev.name) return null;
  const start = parseDateTime(ev.startDate);
  if (!start) return null;
  const end = parseDateTime(ev.endDate);
  const loc = typeof ev.location === "object" && ev.location !== null ? ev.location : null;
  let address: string | null = null;
  let city = "MILANO";
  let lat: number | null = null;
  let lon: number | null = null;
  if (typeof ev.location === "string") {
    address = ev.location;
  } else if (loc) {
    if (typeof loc.address === "string") {
      address = loc.address;
    } else if (loc.address) {
      address = [loc.address.streetAddress, loc.address.addressLocality].filter(Boolean).join(", ");
      if (loc.address.addressLocality) city = loc.address.addressLocality.toUpperCase();
    }
    if (loc.geo) {
      lat = Number(loc.geo.latitude);
      lon = Number(loc.geo.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        lat = null;
        lon = null;
      }
    }
  }
  if (lat !== null && lon !== null && !inMilanoProvince(lat, lon)) return null;
  return {
    sourceId,
    sourceName,
    title: stripHtml(ev.name).slice(0, 300),
    description: ev.description ? stripHtml(ev.description).slice(0, 1500) : null,
    start: start.date,
    end: end?.date ?? null,
    timeStart: start.time,
    timeEnd: end?.time ?? null,
    url: ev.url ?? "",
    venue: loc?.name && loc.name !== "-" ? loc.name : null,
    address,
    city,
    lat,
    lon,
    organizer: null,
  };
}

function allJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      out.push(j);
    } catch {
      continue;
    }
  }
  return out;
}

function flattenLd(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((n) => flattenLd(n));
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    const parts: Record<string, unknown>[] = [o];
    if (o["@graph"]) parts.push(...flattenLd(o["@graph"]));
    if (o.itemListElement) parts.push(...flattenLd(o.itemListElement));
    if (o.item && typeof o.item === "object") parts.push(o.item as Record<string, unknown>);
    return parts;
  }
  return [];
}

export function extractJsonLdEvents(html: string): LdEvent[] {
  const events: LdEvent[] = [];
  for (const node of allJsonLd(html).flatMap(flattenLd)) {
    const ev = node as LdEvent;
    const types = Array.isArray(ev["@type"]) ? ev["@type"] : [ev["@type"]];
    if (types.includes("Event")) events.push(ev);
  }
  return events;
}

export function extractEventLinks(html: string, baseUrl: string, pathRe: RegExp): string[] {
  const urls = new Set<string>();
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    let href = m[1];
    if (href.startsWith("http")) {
      if (pathRe.test(href)) urls.add(href);
    } else if (href.startsWith("/")) {
      const abs = new URL(href, baseUrl).toString();
      if (pathRe.test(abs)) urls.add(abs);
    }
  }
  return [...urls];
}

async function get(fetchImpl: typeof fetch, url: string): Promise<string> {
  const res = await fetchImpl(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/json,application/ld+json,*/*" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export interface CheventiOpts {
  fetchImpl?: typeof fetch;
  maxPages?: number;
  delayMs?: number;
  from?: string;
}

export async function fetchCheventiEvents(opts: CheventiOpts = {}): Promise<ConnectorEvent[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxPages = opts.maxPages ?? 3;
  const delay = opts.delayMs ?? 800;
  const from = opts.from ?? new Date().toISOString().slice(0, 10);
  const listings = [
    "https://www.cheventi.it/regioni/lombardia/milano/",
    "https://www.cheventi.it/regioni/lombardia/",
  ];
  const events: ConnectorEvent[] = [];
  const seen = new Set<string>();
  for (const base of listings) {
    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1 ? base : `${base}page/${page}/`;
      let html: string;
      try {
        html = await get(fetchImpl, url);
      } catch {
        break;
      }
      const lds = extractJsonLdEvents(html);
      let added = 0;
      for (const ev of lds) {
        const ce = ldToConnectorEvent(ev, "cheventi", "Cheventi.it");
        if (!ce || !ce.url) continue;
        if (ce.start < from) continue;
        if (seen.has(ce.url)) continue;
        seen.add(ce.url);
        events.push(ce);
        added++;
      }
      if (added === 0 && lds.length === 0) break;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
  }
  return events;
}

export interface QleverOpts {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  limit?: number;
  from?: string;
}

export async function fetchWikidataEvents(opts: QleverOpts = {}): Promise<ConnectorEvent[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const endpoint = opts.endpoint ?? "https://qlever.dev/api/wikidata";
  const from = opts.from ?? new Date().toISOString().slice(0, 10);
  const query = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?event ?label ?coord ?date ?end WHERE {
  ?event wdt:P31/wdt:P279* wd:Q1656682 .
  ?event wdt:P625 ?coord .
  ?event wdt:P131* wd:Q490 .
  ?event wdt:P585 ?date .
  OPTIONAL { ?event wdt:P582 ?end }
  OPTIONAL { ?event rdfs:label ?label . FILTER(LANG(?label) = "it") }
  FILTER(?date >= "${from}T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>)
} ORDER BY DESC(?date) LIMIT ${opts.limit ?? 100}`;
  const res = await fetchImpl(`${endpoint}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": UA },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`QLever HTTP ${res.status}`);
  const json = (await res.json()) as { results?: { bindings: Array<Record<string, { value: string }>> } };
  const events: ConnectorEvent[] = [];
  const seen = new Set<string>();
  for (const b of json.results?.bindings ?? []) {
    const id = b.event?.value;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const coord = b.coord?.value.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
    const lon = coord ? Number(coord[1]) : null;
    const lat = coord ? Number(coord[2]) : null;
    const date = b.date?.value.slice(0, 10);
    if (!date) continue;
    events.push({
      sourceId: "wikidata",
      sourceName: "Wikidata",
      title: (b.label?.value ?? id).slice(0, 300),
      description: null,
      start: date,
      end: b.end?.value ? b.end.value.slice(0, 10) : null,
      timeStart: null,
      timeEnd: null,
      url: id,
      venue: null,
      address: "Milano",
      city: "MILANO",
      lat: lat !== null && Number.isFinite(lat) ? lat : null,
      lon: lon !== null && Number.isFinite(lon) ? lon : null,
      organizer: null,
    });
  }
  return events;
}

export interface WpVenueOpts {
  fetchImpl?: typeof fetch;
  baseUrl: string;
  sourceName: string;
  restPath: string;
  maxItems?: number;
  delayMs?: number;
  from?: string;
}

const MONTHS: Record<string, string> = {
  gennaio: "01", febbraio: "02", marzo: "03", aprile: "04", maggio: "05", giugno: "06",
  luglio: "07", agosto: "08", settembre: "09", ottobre: "10", novembre: "11", dicembre: "12",
};

export function extractDateFromText(text: string): string | null {
  let m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i);
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  m = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

export async function fetchWpVenueEvents(opts: WpVenueOpts): Promise<ConnectorEvent[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxItems = opts.maxItems ?? 60;
  const delay = opts.delayMs ?? 700;
  const from = opts.from ?? new Date().toISOString().slice(0, 10);
  const listUrl = `${opts.baseUrl}/wp-json/wp/v2/${opts.restPath}?per_page=100&_fields=id,link,title,content,excerpt,date`;
  const res = await fetchImpl(listUrl, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${opts.sourceName} REST HTTP ${res.status}`);
  const items = (await res.json()) as Array<{
    id: number;
    link: string;
    title?: { rendered: string };
    content?: { rendered: string };
    excerpt?: { rendered: string };
  }>;
  const events: ConnectorEvent[] = [];
  for (const item of items.slice(0, maxItems)) {
    const title = stripHtml(item.title?.rendered ?? "");
    const body = stripHtml(`${item.content?.rendered ?? ""} ${item.excerpt?.rendered ?? ""}`);
    const date = extractDateFromText(body) ?? item.link.match(/(\d{4})/)?.[1]
      ? extractDateFromText(body)
      : null;
    const start = date ?? extractDateFromText(item.link);
    if (!start || start < from) continue;
    events.push({
      sourceId: `wp-${opts.restPath}-${opts.baseUrl}`,
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
    if (delay > 0 && events.length < maxItems) await new Promise((r) => setTimeout(r, delay));
  }
  return events;
}

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string | null;
  categories: string[];
}

export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    const body = m[1];
    const pick = (tag: string): string => {
      const mm = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return mm ? mm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
    };
    const cats = [...body.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((c) =>
      c[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim(),
    );
    const title = stripHtml(pick("title"));
    const link = pick("link");
    if (!title || !link) continue;
    items.push({
      title,
      link,
      description: stripHtml(pick("description")) || stripHtml(pick("encoded")),
      pubDate: pick("pubDate") || null,
      categories: cats,
    });
  }
  return items;
}

const EVENT_RE =
  /\b(concerto|concerti|live|dj set|djset|festival|show|mostra|esposizione|spettacolo|teatro|musical|sagra|fiera|mercato|mercato|rassegna|inaugurazione|proiezione|lezione|incontro|workshop|laboratorio|evento|appuntamento|manifestazione|visita guidata|stand-up|comedy|dj)\b/i;

const MI_AREA_RE = /\b(milano|monza|brianza|sesto|segrate|cinisello|rho|pero|assago|rozzano|san donato|melegnano|abbiategrasso|cernusco|gorgonzola|pioltello|cesano|corsico|binasco|cusago|paderno|senago|legnano|busto|castellanza|parabiago|novate|garbagnate|laina|limbiate|arese|baranzate|bollate|cesate|inzago|trezzano|abbiategrasso|magenta|corbetta|sedriano|vittuone|lombardia|MI)\b/i;

export interface NewsRssOpts {
  feedUrl: string;
  sourceId: string;
  sourceName: string;
  fetchImpl?: typeof fetch;
  maxItems?: number;
  fetchDetail?: boolean;
  detailDelayMs?: number;
  from?: string;
}

export async function fetchNewsRssEvents(opts: NewsRssOpts): Promise<ConnectorEvent[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxItems = opts.maxItems ?? 30;
  const from = opts.from ?? new Date().toISOString().slice(0, 10);
  const xml = await get(fetchImpl, opts.feedUrl);
  const items = parseRssItems(xml);
  const events: ConnectorEvent[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (events.length >= maxItems) break;
    const text = `${item.title} ${item.description}`;
    if (!EVENT_RE.test(text)) continue;
    if (!MI_AREA_RE.test(text) && !MI_AREA_RE.test(item.link)) continue;
    const start = extractDateFromText(text) ?? (item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : null);
    if (!start || start < from) continue;
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    let description = item.description.slice(0, 1000) || null;
    if (opts.fetchDetail) {
      try {
        const html = await get(fetchImpl, item.link);
        const ld = extractJsonLdEvents(html).map((e) => ldToConnectorEvent(e, opts.sourceId, opts.sourceName)).filter(Boolean) as ConnectorEvent[];
        const ev = ld[0];
        const bodyText = stripHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " "));
        const dateFromPage = extractDateFromText(bodyText);
        events.push({
          sourceId: opts.sourceId,
          sourceName: opts.sourceName,
          title: item.title.slice(0, 300),
          description: (ev?.description ?? description)?.slice(0, 1000) ?? null,
          start: ev?.start ?? dateFromPage ?? start,
          end: ev?.end ?? null,
          timeStart: ev?.timeStart ?? null,
          timeEnd: ev?.timeEnd ?? null,
          url: item.link,
          venue: ev?.venue ?? null,
          address: ev?.address ?? null,
          city: ev?.city ?? "MILANO",
          lat: ev?.lat ?? null,
          lon: ev?.lon ?? null,
          organizer: opts.sourceName,
        });
        if (opts.detailDelayMs) await new Promise((r) => setTimeout(r, opts.detailDelayMs));
        continue;
      } catch {
        continue;
      }
    }
    events.push({
      sourceId: opts.sourceId,
      sourceName: opts.sourceName,
      title: item.title.slice(0, 300),
      description,
      start,
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
  return events;
}

export { venueId };
