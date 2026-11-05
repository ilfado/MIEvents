export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 MIEvents/0.1 (https://github.com/ilfado/MIEvents)";

export function stripHtml(html: string): string {
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

const MONTHS: Record<string, string> = {
  gennaio: "01", febbraio: "02", marzo: "03", aprile: "04", maggio: "05", giugno: "06",
  luglio: "07", agosto: "08", settembre: "09", ottobre: "10", novembre: "11", dicembre: "12",
};

export function parseDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function parseDateTime(value: string | null | undefined): { date: string; time: string | null } | null {
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, time: iso[4] ? `${iso[4]}:${iso[5]}` : null };
  const dmy = value.match(/^(\d{1,2})[\/](\d{1,2})[\/](\d{4})/);
  if (dmy) return { date: `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`, time: null };
  return null;
}

export const MILANO_CENTER = { lat: 45.4642, lon: 9.19 };

export function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const MONTH_RE = "(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)";
const RE_ISO = /(\d{4})-(\d{2})-(\d{2})/;
const RE_DMY = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/;
const RE_RANGE_CROSS = new RegExp(`dal\\s*(?:l['\u2019])?\\s*(\\d{1,2})\\s*(?:al|a)\\s*(\\d{1,2})\\s+(?:di\\s+)?${MONTH_RE}\\s+(\\d{4})`, "i");
const RE_RANGE_SAME = new RegExp(`dal\\s*(\\d{1,2})\\s*al\\s*(\\d{1,2})\\s*${MONTH_RE}\\s+(\\d{4})`, "i");
const RE_FROM_SINGLE = new RegExp(`dal\\s*(?:l['\u2019])?\\s*(\\d{1,2})\\s+${MONTH_RE}\\s+(\\d{4})`, "i");
const RE_DAY_MONTH = new RegExp(`(\\d{1,2})\\s+${MONTH_RE}\\s+(\\d{4})`, "i");

export function extractDateFromText(text: string): string | null {
  let m = text.match(RE_ISO);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(RE_DMY);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = text.match(RE_RANGE_CROSS);
  if (m) return `${m[4]}-${MONTHS[m[3].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  m = text.match(RE_RANGE_SAME);
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  m = text.match(RE_FROM_SINGLE);
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  m = text.match(RE_DAY_MONTH);
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  return null;
}

const ROME_FMT = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });

export function todayRome(now = new Date()): string {
  const parts = ROME_FMT.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export const MI_PROVINCE_BOUNDS = { south: 44.9, west: 8.4, north: 46.1, east: 10.6 };

export function inMilanoProvince(lat: number, lon: number): boolean {
  return (
    lat >= MI_PROVINCE_BOUNDS.south &&
    lat <= MI_PROVINCE_BOUNDS.north &&
    lon >= MI_PROVINCE_BOUNDS.west &&
    lon <= MI_PROVINCE_BOUNDS.east
  );
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(value: string, field = "date"): string {
  const m = ISO_DATE.exec(value);
  if (!m) throw Object.assign(new Error(`Invalid ${field} date, expected YYYY-MM-DD`), { statusCode: 400 });
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw Object.assign(new Error(`Invalid ${field} date, expected YYYY-MM-DD`), { statusCode: 400 });
  }
  return value;
}

export function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const t = u.trim();
  return /^https?:\/\//i.test(t) ? t : null;
}

export function absUrl(baseUrl: string, href: string): string {
  try {
    const u = new URL(href, baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

export function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

export function normalizeDate(value: string | null | undefined): string | null {
  const v = clean(value);
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

export function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const MI_CITY_RE = /\b(milano|monza|brianza|sesto|segrate|cinisello|rho|pero|assago|rozzano|san donato|melegnano|abbiategrasso|cernusco|gorgonzola|pioltello|cesano|corsico|binasco|cusago|paderno|senago|legnano|busto|castellanza|parabiago|novate|garbagnate|laina|limbiate|arese|baranzate|bollate|cesate|inzago|trezzano|magenta|corbetta|sedriano|vittuone|lombardia|MI)\b/i;

export function joinAddress(segments: Array<string | null | undefined>): string | null {
  const parts = segments.map((s) => clean(s)).filter((s): s is string => s !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function extractLinks(html: string, baseUrl: string, pathRe: RegExp): string[] {
  const urls = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*(["'])(.*?)\1/g)) {
    const abs = absUrl(baseUrl, m[2]);
    if (abs && pathRe.test(abs)) urls.add(abs);
  }
  return [...urls];
}
