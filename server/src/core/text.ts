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

export function extractDateFromText(text: string): string | null {
  let m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i);
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  m = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
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

export function absUrl(baseUrl: string, href: string): string {
  if (href.startsWith("http")) return href;
  return new URL(href, baseUrl).toString();
}

export function extractLinks(html: string, baseUrl: string, pathRe: RegExp): string[] {
  const urls = new Set<string>();
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const abs = absUrl(baseUrl, m[1]);
    if (pathRe.test(abs)) urls.add(abs);
  }
  return [...urls];
}
