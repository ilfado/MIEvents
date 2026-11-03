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
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : null };
}

const MONTH_RE = "(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)";

export function extractDateFromText(text: string): string | null {
  let m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const monthAlt = MONTH_RE;
  const range = new RegExp(
    `dal\\s*(?:l['’])?\\s*(\\d{1,2})\\s*(?:al|a)\\s*(\\d{1,2})\\s+(?:di\\s+)?${monthAlt}\\s+(\\d{4})`,
    "i",
  );
  m = text.match(range);
  if (m) return `${m[4]}-${MONTHS[m[3].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  const rangeSameMonth = new RegExp(`dal\\s*(\\d{1,2})\\s*al\\s*(\\d{1,2})\\s*${monthAlt}\\s+(\\d{4})`, "i");
  m = text.match(rangeSameMonth);
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  const fromSingle = new RegExp(`dal\\s*(?:l['’])?\\s*(\\d{1,2})\\s+${monthAlt}\\s+(\\d{4})`, "i");
  m = text.match(fromSingle);
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  m = text.match(new RegExp(`(\\d{1,2})\\s+${monthAlt}\\s+(\\d{4})`, "i"));
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  return null;
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
