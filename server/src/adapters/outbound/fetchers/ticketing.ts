import type { EventSource, SourceContext } from "../../../application/ports.js";
import type { SourceResult, EventDraft } from "../../../core/types.js";
import { distKm, inMilanoProvince, MILANO_CENTER } from "../../../core/text.js";
import { isBigEvent } from "../../../core/big-events.js";
import { getJson } from "./http.js";

export function apiKeysFromEnv(env: NodeJS.ProcessEnv): { ticketmaster?: string; eventbriteUser?: string; bandsintown?: string } {
  return {
    ticketmaster: env.TICKETMASTER_API_KEY?.trim() || undefined,
    eventbriteUser: env.EVENTBRITE_USER_TOKEN?.trim() || undefined,
    bandsintown: env.BANDSINTWN_APP_ID?.trim() || undefined,
  };
}

export function bitArtistsFromEnv(env: NodeJS.ProcessEnv): string[] {
  return (env.BANDSINTWN_ARTISTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export const DEFAULT_BIT_ARTISTS = [
  "Coez", "Calcutta", "Madame", "Mahmood", "Annalisa", "Giorgia", "Elodie", "Marco Mengoni",
  "Cesare Cremonini", "Samuele Bersani", "Brunori Sas", "Mecna", "Gazzelle", "Tha Sup", "Sfera Ebbasta",
  "Lazza", "Tananai", "Gaia", "Coma Cose", "Pinguini Tattici Nucleari", "Mambolosco", "Rkomi",
  "Blanco", "Ariete", "Ditonpiaga", "Levante", "Emma", "Alessandra Amoroso", "Fedez", "Jovanotti",
  "Vasco Rossi", "Ligabue", "Negramaro", "Subsonica", "Planet Funk", "Pooh", "Riccardo Cocciante",
  "Antonello Venditti", "Francesco De Gregori", "Lucio Dalla", "Mina", "Laura Pausini", "Eros Ramazzotti",
  "Andrea Bocelli", "Zucchero", "Elisa", "Tiziano Ferro", "Max Pezzali", "883", "The Kolors",
];

interface BitEvent {
  datetime?: string;
  url?: string;
  description?: string;
  title?: string;
  artists?: Array<{ name?: string }>;
  venue?: { name?: string; city?: string; street_address?: string; latitude?: string; longitude?: string };
}

function mapBit(e: BitEvent, from: string): EventDraft | null {
  if (!e.datetime) return null;
  const start = e.datetime.slice(0, 10);
  if (start < from) return null;
  const lat = e.venue?.latitude ? Number(e.venue.latitude) : null;
  const lon = e.venue?.longitude ? Number(e.venue.longitude) : null;
  if (!(lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon) && inMilanoProvince(lat, lon))) return null;
  const artists = (e.artists ?? []).map((a) => a.name).filter(Boolean) as string[];
  const title = e.title || (artists.length > 0 ? `${artists.join(", ")} in concerto` : null);
  if (!title) return null;
  return {
    sourceId: "bandsintown",
    sourceName: "Bandsintown",
    title: title.slice(0, 300),
    description: e.description?.slice(0, 1000) ?? null,
    start,
    end: null,
    timeStart: e.datetime.includes("T") ? e.datetime.slice(11, 16) : null,
    timeEnd: null,
    url: e.url ?? "",
    venue: e.venue?.name ?? null,
    address: e.venue?.street_address ?? null,
    city: (e.venue?.city ?? "MILANO").toUpperCase(),
    lat: lat !== null && Number.isFinite(lat) ? lat : null,
    lon: lon !== null && Number.isFinite(lon) ? lon : null,
    organizer: artists[0] ?? null,
  };
}

export function ticketingSources(env: NodeJS.ProcessEnv): EventSource[] {
  if ((env.TICKETING_SOURCES ?? "0") !== "1") return [];
  const keys = apiKeysFromEnv(env);
  const sources: EventSource[] = [];

  if (keys.ticketmaster) {
    const apiKey = keys.ticketmaster;
    sources.push({
      id: "ticketmaster",
      async run(ctx: SourceContext): Promise<SourceResult> {
        const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
        const from = fmt(new Date());
        const end = fmt(new Date(`${ctx.toDate}T23:59:59Z`));
        const url =
          `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(apiKey)}` +
          `&latLong=45.4642,9.19&radius=100&unit=km&classificationName=music,arts&family` +
          `&startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(end)}&size=${ctx.limits["ticketmasterSize"] ?? 100}&sort=date,asc`;
        const json = (await getJson(ctx.fetchImpl, url)) as { _embedded?: { events?: Array<Record<string, any>> } };
        const events: EventDraft[] = [];
        for (const e of json._embedded?.events ?? []) {
          const name: string = e.name ?? "";
          const start = e.dates?.start?.localDate ?? e.dates?.start?.dateTime?.slice(0, 10);
          if (!start || !name) continue;
          const venue = (e._embedded?.venues?.[0] ?? {}) as Record<string, any>;
          const lat = venue.location?.latitude ? Number(venue.location.latitude) : null;
          const lon = venue.location?.longitude ? Number(venue.location.longitude) : null;
          const tmOk = lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon) && distKm(lat, lon, MILANO_CENTER.lat, MILANO_CENTER.lon) <= 100;
          if (!tmOk) continue;
          if (isBigEvent(venue.name ?? null, venue.address?.line1 ?? null, name)) continue;
          const pr = Array.isArray(e.priceRanges) ? e.priceRanges[0] : null;
          const pmin = pr?.min != null ? Number(pr.min) : null;
          const pmax = pr?.max != null ? Number(pr.max) : null;
          if (pmax !== null && Number.isFinite(pmax) && pmax >= 35) continue;
          events.push({
            sourceId: "ticketmaster",
            sourceName: "Ticketmaster",
            title: name.slice(0, 300),
            description: (e.info ?? e.description ?? null)?.slice(0, 1000) ?? null,
            start,
            end: null,
            timeStart: e.dates?.start?.localTime ?? null,
            timeEnd: null,
            url: e.url ?? "",
            venue: venue.name ?? null,
            address: venue.address?.line1 ?? null,
            city: (venue.city?.name ?? "MILANO").toUpperCase(),
            lat: lat !== null && Number.isFinite(lat) ? lat : null,
            lon: lon !== null && Number.isFinite(lon) ? lon : null,
            organizer: null,
            priceMin: pmin !== null && Number.isFinite(pmin) ? pmin : null,
            priceMax: pmax !== null && Number.isFinite(pmax) ? pmax : null,
          });
        }
        return { sourceId: "ticketmaster", events };
      },
    });
  }

  if (keys.eventbriteUser && env.EVENTBRITE_SEARCH === "1") {
    const token = keys.eventbriteUser;
    sources.push({
      id: "eventbrite",
      async run(ctx: SourceContext): Promise<SourceResult> {
        const from = new Date().toISOString();
        const to = `${ctx.toDate}T23:59:59Z`;
        const url =
          `https://www.eventbriteapi.com/v3/events/search/?location.address=Milano,Italy&location.within=100km` +
          `&start_date.range_start=${encodeURIComponent(from)}&start_date.range_end=${encodeURIComponent(to)}` +
          `&expand=venue,organizer&page_size=100&order_by=start_asc`;
        const json = (await getJson(ctx.fetchImpl, url, { Authorization: `Bearer ${token}` })) as { events?: Array<Record<string, any>> };
        const events: EventDraft[] = [];
        for (const e of json.events ?? []) {
          const name: string = e.name?.text ?? "";
          const start: string | undefined = e.start?.local ?? e.start?.utc?.slice(0, 10);
          if (!start || !name) continue;
          const venue = e.venue as Record<string, any> | undefined;
          const lat = venue?.latitude ? Number(venue.latitude) : null;
          const lon = venue?.longitude ? Number(venue.longitude) : null;
          const ebOk = lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon) && inMilanoProvince(lat, lon);
          if (!ebOk) continue;
          if (start.slice(0, 10) > ctx.toDate) continue;
          events.push({
            sourceId: "eventbrite",
            sourceName: "Eventbrite",
            title: name.slice(0, 300),
            description: e.description?.text?.slice(0, 1000) ?? null,
            start: start.slice(0, 10),
            end: e.end?.local?.slice(0, 10) ?? null,
            timeStart: start.includes("T") ? start.slice(11, 16) : null,
            timeEnd: null,
            url: e.url ?? "",
            venue: venue?.name ?? null,
            address: venue?.address?.localized_address_display ?? venue?.address?.address_1 ?? null,
            city: (venue?.address?.city ?? "MILANO").toUpperCase(),
            lat: lat !== null && Number.isFinite(lat) ? lat : null,
            lon: lon !== null && Number.isFinite(lon) ? lon : null,
            organizer: e.organizer?.name ?? null,
          });
        }
        return { sourceId: "eventbrite", events };
      },
    });
  }

  if (keys.bandsintown) {
    const appId = keys.bandsintown;
    sources.push({
      id: "bandsintown",
      async run(ctx: SourceContext): Promise<SourceResult> {
        const artists = bitArtistsFromEnv(env);
        const list = artists.length > 0 ? artists : DEFAULT_BIT_ARTISTS;
        const maxArtists = ctx.limits["bitArtists"] ?? 25;
        const delay = 600;
        const events: EventDraft[] = [];
        const seen = new Set<string>();
        let used = 0;
        for (const artist of list) {
          if (used >= maxArtists) break;
          const name = artist.trim();
          if (!name) continue;
          const url = `https://rest.bandsintown.com/artists/${encodeURIComponent(name)}/events?app_id=${encodeURIComponent(appId)}&date=upcoming`;
          try {
            const arr = (await getJson(ctx.fetchImpl, url)) as BitEvent[];
            used++;
            for (const e of Array.isArray(arr) ? arr : []) {
              const ev = mapBit(e, ctx.fromDate);
              if (!ev) continue;
              const key = `${ev.title}|${ev.start}|${ev.venue ?? ""}`;
              if (seen.has(key)) continue;
              seen.add(key);
              events.push(ev);
            }
            if (delay > 0 && used < maxArtists) await new Promise((r) => setTimeout(r, delay));
          } catch {
            continue;
          }
        }
        return { sourceId: "bandsintown", events };
      },
    });
  }

  return sources;
}
