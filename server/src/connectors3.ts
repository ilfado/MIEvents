export interface ApiKeyConfig {
  ticketmaster?: string;
  eventbrite?: string;
  bandsintown?: string;
}

export function apiKeysFromEnv(env: NodeJS.ProcessEnv = process.env): ApiKeyConfig {
  return {
    ticketmaster: env.TICKETMASTER_API_KEY?.trim() || undefined,
    eventbrite: env.EVENTBRITE_TOKEN?.trim() || undefined,
    bandsintown: env.BANDSINTWN_APP_ID?.trim() || undefined,
  };
}

export function bitArtistsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.BANDSINTWN_ARTISTS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const UA = "MIEvents/0.1 (https://github.com/ilfado/MIEvents)";

export interface TicketingEvent {
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

export async function fetchTicketmasterEvents(
  apiKey: string,
  opts: { fetchImpl?: typeof fetch; from?: string; size?: number } = {},
): Promise<TicketingEvent[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const from = opts.from ?? new Date().toISOString();
  const url =
    `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(apiKey)}` +
    `&latLong=45.4642,9.19&radius=50&unit=km&classificationName=music,arts&startDateTime=${encodeURIComponent(from)}&size=${opts.size ?? 100}&sort=date,asc`;
  const res = await fetchImpl(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Ticketmaster HTTP ${res.status}`);
  const json = (await res.json()) as {
    _embedded?: { events?: Array<Record<string, unknown>> };
  };
  const events: TicketingEvent[] = [];
  const rawEvents = (json._embedded?.events ?? []) as Array<Record<string, any>>;
  for (const e of rawEvents) {
    const name: string = e.name ?? "";
    const dates = e.dates as { start?: { dateTime?: string; localDate?: string; localTime?: string } } | undefined;
    const start = dates?.start?.localDate ?? dates?.start?.dateTime?.slice(0, 10);
    if (!start || !name) continue;
    const venue = ((e._embedded?.venues?.[0] ?? {}) as Record<string, any>) as {
      name?: string;
      city?: { name?: string };
      address?: { line1?: string };
      location?: { latitude?: string; longitude?: string };
    };
    const lat = venue.location?.latitude ? Number(venue.location.latitude) : null;
    const lon = venue.location?.longitude ? Number(venue.location.longitude) : null;
    events.push({
      sourceId: "ticketmaster",
      sourceName: "Ticketmaster",
      title: name.slice(0, 300),
      description: ((e.info as string) || (e.description as string) || null)?.slice(0, 1000) ?? null,
      start,
      end: null,
      timeStart: dates?.start?.localTime ?? null,
      timeEnd: null,
      url: (e.url as string) ?? "",
      venue: venue.name ?? null,
      address: venue.address?.line1 ?? null,
      city: (venue.city?.name ?? "MILANO").toUpperCase(),
      lat: lat !== null && Number.isFinite(lat) ? lat : null,
      lon: lon !== null && Number.isFinite(lon) ? lon : null,
      organizer: null,
    });
  }
  return events;
}

export async function fetchEventbriteEvents(
  token: string,
  opts: { fetchImpl?: typeof fetch; from?: string } = {},
): Promise<TicketingEvent[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const from = opts.from ?? new Date().toISOString();
  const url =
    `https://www.eventbriteapi.com/v3/events/search/?location.address=Milano,Italy&location.within=50km` +
    `&start_date.range_start=${encodeURIComponent(from)}&expand=venue&page_size=50`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Eventbrite HTTP ${res.status}`);
  const json = (await res.json()) as { events?: Array<Record<string, any>> };
  const events: TicketingEvent[] = [];
  for (const e of json.events ?? []) {
    const name: string = e.name?.text ?? "";
    const start: string | undefined = e.start?.local ?? e.start?.utc?.slice(0, 10);
    if (!start || !name) continue;
    const venue = e.venue as
      | { name?: string; address?: { address_1?: string; city?: string; localized_address_display?: string }; latitude?: string; longitude?: string }
      | undefined;
    events.push({
      sourceId: "eventbrite",
      sourceName: "Eventbrite",
      title: name.slice(0, 300),
      description: ((e.description as { text?: string })?.text ?? null)?.slice(0, 1000) ?? null,
      start: start.slice(0, 10),
      end: ((e.end as { local?: string })?.local ?? null)?.slice(0, 10) ?? null,
      timeStart: start.includes("T") ? start.slice(11, 16) : null,
      timeEnd: null,
      url: (e.url as string) ?? "",
      venue: venue?.name ?? null,
      address: venue?.address?.localized_address_display ?? venue?.address?.address_1 ?? null,
      city: (venue?.address?.city ?? "MILANO").toUpperCase(),
      lat: venue?.latitude ? Number(venue.latitude) : null,
      lon: venue?.longitude ? Number(venue.longitude) : null,
      organizer: ((e.organizer as { name?: string })?.name) ?? null,
    });
  }
  return events;
}

const MI_PROVINCE = { south: 44.9, west: 8.4, north: 46.1, east: 10.6 };

interface BandsintownArtistEvent {
  id?: string;
  datetime?: string;
  url?: string;
  description?: string;
  title?: string;
  artists?: Array<{ name?: string }>;
  venue?: {
    name?: string;
    city?: string;
    region?: string;
    country?: string;
    street_address?: string;
    latitude?: string;
    longitude?: string;
  };
}

function mapBitEvent(e: BandsintownArtistEvent, from: string): TicketingEvent | null {
  if (!e.datetime) return null;
  const start = e.datetime.slice(0, 10);
  if (start < from) return null;
  const lat = e.venue?.latitude ? Number(e.venue.latitude) : null;
  const lon = e.venue?.longitude ? Number(e.venue.longitude) : null;
  if (lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon)) {
    if (lat < MI_PROVINCE.south || lat > MI_PROVINCE.north || lon < MI_PROVINCE.west || lon > MI_PROVINCE.east) return null;
  }
  const artistNames = (e.artists ?? []).map((a) => a.name).filter(Boolean);
  const title = e.title || (artistNames.length > 0 ? `${artistNames.join(", ")} in concerto` : null);
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
    organizer: artistNames[0] ?? null,
  };
}

export interface BandsintownOpts {
  fetchImpl?: typeof fetch;
  from?: string;
  artists?: string[];
  maxArtists?: number;
  delayMs?: number;
}

export async function fetchBandsintownEvents(
  appId: string,
  opts: BandsintownOpts = {},
): Promise<TicketingEvent[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const from = opts.from ?? new Date().toISOString().slice(0, 10);
  const artists = opts.artists ?? [];
  const maxArtists = opts.maxArtists ?? 25;
  const delay = opts.delayMs ?? 600;
  const events: TicketingEvent[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const artist of artists) {
    if (used >= maxArtists) break;
    const name = artist.trim();
    if (!name) continue;
    const url = `https://rest.bandsintown.com/artists/${encodeURIComponent(name)}/events?app_id=${encodeURIComponent(appId)}&date=upcoming`;
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": UA },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      const arr = (await res.json()) as BandsintownArtistEvent[];
      used++;
      for (const e of Array.isArray(arr) ? arr : []) {
        const ev = mapBitEvent(e, from);
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
  return events;
}

export const DEFAULT_BIT_ARTISTS = [
  "Coez", "Calcutta", "Madame", "Mahmood", "Annalisa", "Giorgia", "Elodie", "Marco Mengoni",
  "Cesare Cremonini", "Samuele Bersani", " Brunori Sas", "Mecna", "Gazzelle", "Tha Sup", "Sfera Ebbasta",
  "Lazza", "Tananai", " Gaia", "Coma Cose", "Pinguini Tattici Nucleari", "Mambolosco", "Rkomi",
  " Blanco", "Ariete", "Ditonpiaga", "Levante", "Emma", " Alessandra Amoroso", "Fedez", "Jovanotti",
  "Vasco Rossi", "Ligabue", "Negramaro", "Subsonica", "Planet Funk", "Pooh", "Riccardo Cocciante",
  "Antonello Venditti", "Francesco De Gregori", "Lucio Dalla", "Mina", "Laura Pausini", "Eros Ramazzotti",
  "Andrea Bocelli", "Zucchero", "Elisa", "Tiziano Ferro", "Max Pezzali", "883", "The Kolors",
];

