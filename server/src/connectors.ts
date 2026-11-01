import { createHash } from "node:crypto";
import type { MiEvent } from "@mievents/shared";
import { categorize } from "./normalize.js";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 MIEvents/0.1 (https://github.com/ilfado/MIEvents)";

export interface Connector {
  id: string;
  name: string;
  kind: "http-listing" | "http-detail";
  enabled: boolean;
}

export interface ConnectorEvent {
  sourceId: string;
  sourceName: string;
  title: string;
  description: string | null;
  start: string;
  end: string | null;
  url: string;
  venue: string | null;
  address: string | null;
  city: string;
  organizer: string | null;
}

export interface FetchPageResult {
  events: ConnectorEvent[];
  detailUrls: string[];
}

function abs(base: string, href: string): string {
  if (href.startsWith("http")) return href;
  return new URL(href, base).toString();
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
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

interface JsonLdNode {
  "@type"?: string | string[];
  name?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  description?: string;
  location?: {
    name?: string;
    address?: string | { streetAddress?: string; addressLocality?: string };
  } | string;
}

export function parseEventJsonLd(html: string, pageUrl: string): ConnectorEvent | null {
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
    for (const node of nodes.flat()) {
      const ev = node as JsonLdNode;
      const types = Array.isArray(ev?.["@type"]) ? ev["@type"] : [ev?.["@type"]];
      if (!types.includes("Event") || !ev.name) continue;
      const start = normalizeDate(ev.startDate);
      if (!start) continue;
      const loc = typeof ev.location === "object" && ev.location !== null ? ev.location : null;
      const addressRaw =
        typeof ev.location === "string"
          ? ev.location
          : [loc?.name, typeof loc?.address === "string" ? loc.address : [loc?.address?.streetAddress, loc?.address?.addressLocality].filter(Boolean).join(", ")]
              .filter(Boolean)
              .join(", ");
      const KNOWN_QUARTERS = /^(barona|brera|navigli|duomo|centrale|ticinese|portanuova|garibaldi|isola|bovisa|qt8|loreto|lambrate|romana|sempione|vittoria|vercelli|monumentale|giardini|porta Nuova)$/i;
      const parts = addressRaw.split(",").map((p) => p.trim()).filter(Boolean);
      const city =
        [...parts].reverse().find((p) => /^[A-Z][A-Za-zÀ-ù' ]{2,25}$/.test(p) && !KNOWN_QUARTERS.test(p))?.toUpperCase() ?? "MILANO";
      return {
        sourceId: "",
        sourceName: "",
        title: stripHtml(ev.name).slice(0, 300),
        description: ev.description ? stripHtml(ev.description).slice(0, 1500) : null,
        start,
        end: normalizeDate(ev.endDate),
        url: ev.url ?? pageUrl,
        venue: loc?.name ?? null,
        address: addressRaw || null,
        city,
        organizer: null,
      };
    }
  }
  return null;
}

const EVENT_PATH = /\/eventi\/[a-z0-9][a-z0-9-]*\.html$/i;

export function parseMilanotodayListing(html: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (EVENT_PATH.test(href)) urls.add(abs(baseUrl, href));
  }
  return [...urls];
}

export function milanotodayRangeUrl(from: string, to: string): string {
  return `https://www.milanotoday.it/eventi/dal/${from}/al/${to}/`;
}

export interface MilanotodayConnectorOpts {
  fetchImpl?: typeof fetch;
  maxPages?: number;
  maxDetails?: number;
  detailDelayMs?: number;
  from?: string;
  to?: string;
}

export async function fetchMilanotodayEvents(opts: MilanotodayConnectorOpts = {}): Promise<ConnectorEvent[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxPages = opts.maxPages ?? 1;
  const maxDetails = opts.maxDetails ?? 60;
  const delay = opts.detailDelayMs ?? 700;
  const today = new Date();
  const from = opts.from ?? today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 60 * 86400000);
  const to = opts.to ?? end.toISOString().slice(0, 10);

  const detailUrls: string[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? milanotodayRangeUrl(from, to) : `${milanotodayRangeUrl(from, to)}?page=${page}`;
    const res = await fetchImpl(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`MilanoToday listing ${url}: HTTP ${res.status}`);
    const html = await res.text();
    const found = parseMilanotodayListing(html, url);
    for (const u of found) if (!detailUrls.includes(u)) detailUrls.push(u);
    if (found.length === 0) break;
  }

  const events: ConnectorEvent[] = [];
  const seen = new Set<string>();
  let count = 0;
  for (const url of detailUrls) {
    if (count >= maxDetails) break;
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": UA, Accept: "text/html" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const ev = parseEventJsonLd(html, url);
      if (!ev) continue;
      if (ev.start < from) continue;
      const key = `${ev.title}|${ev.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ ...ev, sourceId: "milanotoday-eventi", sourceName: "MilanoToday Eventi" });
      count++;
      if (delay > 0 && count < detailUrls.length) await new Promise((r) => setTimeout(r, delay));
    } catch {
      continue;
    }
  }
  return events;
}

export function connectorEventToMiEvent(e: ConnectorEvent, fetchedAt: string): MiEvent {
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
    timeStart: null,
    timeEnd: null,
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
    lat: null,
    lon: null,
    saved: false,
    fetchedAt,
  };
}

export const CONNECTORS: Connector[] = [
  { id: "lombardia-sagre", name: "Regione Lombardia (open data)", kind: "http-listing", enabled: true },
  { id: "milanotoday-eventi", name: "MilanoToday Eventi", kind: "http-detail", enabled: true },
];
