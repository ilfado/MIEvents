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

export async function fetchBandsintownEvents(
  appId: string,
  opts: { fetchImpl?: typeof fetch; from?: string } = {},
): Promise<TicketingEvent[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const from = opts.from ?? new Date().toISOString().slice(0, 10);
  const url = `https://rest.bandsintown.com/v4/events?location=Milan,Italy&app_id=${encodeURIComponent(appId)}&date=upcoming&per_page=100`;
  const res = await fetchImpl(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Bandsintown HTTP ${res.status}`);
  const arr = (await res.json()) as Array<{
    name?: string;
    datetime?: string;
    url?: string;
    description?: string;
    venue?: { name?: string; city?: string; latitude?: string; longitude?: string; street_address?: string };
  }>;
  const events: TicketingEvent[] = [];
  for (const e of arr ?? []) {
    if (!e.name || !e.datetime) continue;
    const start = e.datetime.slice(0, 10);
    if (start < from) continue;
    events.push({
      sourceId: "bandsintown",
      sourceName: "Bandsintown",
      title: e.name.slice(0, 300),
      description: e.description?.slice(0, 1000) ?? null,
      start,
      end: null,
      timeStart: e.datetime.includes("T") ? e.datetime.slice(11, 16) : null,
      timeEnd: null,
      url: e.url ?? "",
      venue: e.venue?.name ?? null,
      address: e.venue?.street_address ?? null,
      city: (e.venue?.city ?? "MILANO").toUpperCase(),
      lat: e.venue?.latitude ? Number(e.venue.latitude) : null,
      lon: e.venue?.longitude ? Number(e.venue.longitude) : null,
      organizer: null,
    });
  }
  return events;
}
