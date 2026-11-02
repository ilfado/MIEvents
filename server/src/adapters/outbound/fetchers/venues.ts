import type { VenueSource, VenueSourceContext } from "../../../application/ports.js";
import type { VenueDraft } from "../../../core/types.js";
import { absUrl, inMilanoProvince, stripHtml } from "../../../core/text.js";
import { getJson, getText, sleep } from "./http.js";
import { apiKeysFromEnv } from "./ticketing.js";

export const TM_MILANO_CENTER = "45.4642,9.19";
export const TM_VENUES_RADIUS_KM = 100;

interface TmVenue {
  id?: string;
  name?: string;
  url?: string;
  address?: { line1?: string };
  city?: { name?: string };
  state?: { stateCode?: string };
  postalCode?: string;
  country?: { countryCode?: string };
  location?: { latitude?: string; longitude?: string };
}

interface TmVenuesResponse {
  _embedded?: { venues?: TmVenue[] };
  page?: { size?: number; totalElements?: number; totalPages?: number; number?: number };
}

export function ticketmasterVenuesSource(apiKey: string): VenueSource {
  return {
    id: "ticketmaster-venues",
    async run(ctx: VenueSourceContext) {
      const size = 100;
      const maxPages = ctx.limits["tmVenuesPages"] ?? 5;
      const venues: VenueDraft[] = [];
      const seen = new Set<string>();
      for (let page = 0; page < maxPages; page++) {
        const url =
          `https://app.ticketmaster.com/discovery/v2/venues.json?apikey=${encodeURIComponent(apiKey)}` +
          `&latLong=${TM_MILANO_CENTER}&radius=${TM_VENUES_RADIUS_KM}&unit=km&size=${size}&page=${page}`;
        const json = (await getJson(ctx.fetchImpl, url)) as TmVenuesResponse;
        const rows = json._embedded?.venues ?? [];
        if (rows.length === 0) break;
        for (const v of rows) {
          const name = v.name?.trim();
          if (!name) continue;
          const cityName = (v.city?.name ?? "MILANO").trim();
          const lat = v.location?.latitude ? Number(v.location.latitude) : null;
          const lon = v.location?.longitude ? Number(v.location.longitude) : null;
          const hasCoords = lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon);
          if (hasCoords && !inMilanoProvince(lat, lon)) continue;
          if (!hasCoords && !/milano/i.test(cityName)) continue;
          const address = [v.address?.line1, v.postalCode, cityName, v.state?.stateCode ?? "MI"].filter(Boolean).join(", ");
          const key = `${name.toLowerCase()}|${cityName.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          venues.push({
            name,
            address: address || null,
            city: cityName.toUpperCase(),
            lat: hasCoords ? lat : null,
            lon: hasCoords ? lon : null,
            source: "ticketmaster",
            url: v.url ?? null,
          });
        }
        const totalPages = json.page?.totalPages ?? 1;
        if (page + 1 >= totalPages) break;
      }
      return { sourceId: "ticketmaster-venues", venues };
    },
  };
}

const ARCI_SEARCH_URL = "https://portale.arci.it/cerca/circolo/";
const ARCI_DETAIL_RE = /href="([^"]*\/dettaglio\/circolo\/\d+\/[^"]*\/)"/g;
const ARCI_ADDRESS_RE =
  /\b((?:VIA|CORSO|PIAZZA|P\.?\s?ZA|VIALE|LARGO|STRADA|LOC(?:ALITA|\.)?|BORGO)\s+[^<,;]{2,60}?,\s*\d{1,4}[A-Z]?)\s*-\s*(\d{5})\s+([A-ZÀ-Þ][A-ZÀ-Þ'’\- ]{1,40}?)\s+([A-Z]{2})\b/i;

function findComitatoParam(html: string): { name: string; value: string } | null {
  const selectRe = /<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi;
  let m: RegExpExecArray | null;
  while ((m = selectRe.exec(html))) {
    const name = m[1];
    const body = m[2];
    const optRe = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
    let o: RegExpExecArray | null;
    while ((o = optRe.exec(body))) {
      const label = stripHtml(o[2]).trim();
      if (/MILANO\s*-\s*LO\s*-\s*MB/i.test(label) || /^ARCI\s*MILANO\b/i.test(label)) {
        return { name, value: o[1] };
      }
    }
  }
  return null;
}

export function parseArciDetail(html: string, url: string): VenueDraft | null {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const name = stripHtml(h1?.[1] ?? "").trim();
  const sede = /Sede legale[\s\S]{0,300}?/.exec(html);
  const m = ARCI_ADDRESS_RE.exec(sede ? html.slice(Math.max(0, (sede.index ?? 0) - 50)) : html);
  if (!name || !m) return null;
  const street = m[1].replace(/\s+/g, " ").trim();
  const cap = m[2];
  const city = m[3].replace(/\s+/g, " ").trim().toUpperCase();
  const prov = m[4].toUpperCase();
  if (prov !== "MI") return null;
  return {
    name: name.slice(0, 200),
    address: `${street}, ${cap} ${city} ${prov}`,
    city,
    lat: null,
    lon: null,
    source: "arci",
    url,
  };
}

export const arciCircoliSource: VenueSource = {
  id: "arci-circoli",
  async run(ctx: VenueSourceContext) {
    const maxPages = ctx.limits["arciPages"] ?? 4;
    const maxDetails = ctx.limits["arciDetails"] ?? 60;
    const delayMs = 700;
    const first = await getText(ctx.fetchImpl, ARCI_SEARCH_URL);
    const comitato = findComitatoParam(first);
    const links = new Set<string>();
    for (let page = 1; page <= maxPages; page++) {
      const url = comitato
        ? `${ARCI_SEARCH_URL}?${encodeURIComponent(comitato.name)}=${encodeURIComponent(comitato.value)}&p=${page}`
        : `${ARCI_SEARCH_URL}?p=${page}`;
      const html = page === 1 ? first : await getText(ctx.fetchImpl, url);
      let found = 0;
      for (const m of html.matchAll(ARCI_DETAIL_RE)) {
        const abs = absUrl(ARCI_SEARCH_URL, m[1]);
        if (!links.has(abs)) {
          links.add(abs);
          found++;
        }
      }
      if (found === 0) break;
    }
    const venues: VenueDraft[] = [];
    const seen = new Set<string>();
    let used = 0;
    for (const link of links) {
      if (used >= maxDetails) break;
      try {
        const html = await getText(ctx.fetchImpl, link);
        used++;
        const draft = parseArciDetail(html, link);
        if (!draft) continue;
        const key = `${draft.name.toLowerCase()}|${draft.address?.toLowerCase() ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        venues.push(draft);
        if (delayMs > 0 && used < maxDetails) await sleep(delayMs);
      } catch {
        continue;
      }
    }
    return { sourceId: "arci-circoli", venues };
  },
};

export function venueSources(env: NodeJS.ProcessEnv): VenueSource[] {
  const sources: VenueSource[] = [];
  const tmKey = apiKeysFromEnv(env).ticketmaster;
  if (tmKey) sources.push(ticketmasterVenuesSource(tmKey));
  sources.push(arciCircoliSource);
  return sources;
}
