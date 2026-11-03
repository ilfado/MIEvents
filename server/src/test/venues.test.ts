import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createEventRepository, createVenueRepository } from "../adapters/outbound/repositories/sqlite.js";
import { runSync } from "../application/services/sync.js";
import { runVenueSync } from "../application/services/venue-sync.js";
import type { EventSource, SourceContext, VenueSource } from "../application/ports.js";
import type { EventDraft, SourceResult, VenueDraft } from "../core/types.js";
import { pinForVenue } from "../core/venue-pins.js";
import { ticketmasterVenuesSource, arciCircoliSource, parseArciDetail } from "../adapters/outbound/fetchers/venues.js";
import { ticketingSources } from "../adapters/outbound/fetchers/ticketing.js";

function makeCtx(over: Partial<SourceContext>): SourceContext {
  return {
    fetchImpl: (async () => new Response("", { status: 200 })) as typeof fetch,
    fromDate: "2026-11-01",
    toDate: "2026-12-31",
    geocode: false,
    geocodeSleepMs: 0,
    maxGeocode: 0,
    limits: {},
    env: {},
    venues: {} as never,
    geocoder: { async geocode() { return null; } },
    now: () => "2026-11-01T00:00:00Z",
    ...over,
  };
}

const TM_VENUES_PAGE0 = {
  _embedded: {
    venues: [
      { id: "v1", name: "Magazzini Generali", url: "https://tm/v/1", address: { line1: "Via Pietrasanta 16" }, city: { name: "Milano" }, postalCode: "20141", location: { latitude: "45.4441", longitude: "9.1953" } },
      { id: "v2", name: "Stadio San Siro", address: { line1: "Piazzale dello Sport 5" }, city: { name: "Milano" }, location: { latitude: "45.4781", longitude: "9.124" } },
      { id: "v3", name: "Venue Tokyo", city: { name: "Tokyo" }, location: { latitude: "35.6", longitude: "139.7" } },
      { id: "v4", name: "Circolo Senza Geo", city: { name: "Milano" } },
    ],
  },
  page: { size: 100, totalPages: 2, number: 0, totalElements: 5 },
};

const TM_VENUES_PAGE1 = {
  _embedded: {
    venues: [
      { id: "v5", name: "Alcatraz", city: { name: "Milano" }, location: { latitude: "45.4946", longitude: "9.1825" } },
      { id: "v1", name: "Magazzini Generali", city: { name: "Milano" }, location: { latitude: "45.4441", longitude: "9.1953" } },
    ],
  },
  page: { size: 100, totalPages: 2, number: 1 },
};

test("ticketmaster venues source: latLong Milano, radius 100km, paginazione, filtro provincia, dedup", async () => {
  const urls: string[] = [];
  const mockFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    urls.push(u);
    if (u.includes("page=1")) return new Response(JSON.stringify(TM_VENUES_PAGE1), { status: 200 });
    return new Response(JSON.stringify(TM_VENUES_PAGE0), { status: 200 });
  }) as typeof fetch;
  const src = ticketmasterVenuesSource("K");
  const res = await src.run({ fetchImpl: mockFetch, limits: { tmVenuesPages: 5 }, env: {}, now: () => "2026-11-01T00:00:00Z" });
  assert.ok(urls[0].includes("https://app.ticketmaster.com/discovery/v2/venues.json"));
  assert.ok(urls[0].includes("latLong=45.4642,9.19"));
  assert.ok(urls[0].includes("radius=100&unit=km"));
  assert.ok(urls[0].includes("apikey=K"));
  assert.equal(urls.length, 2);
  assert.equal(res.venues.length, 4);
  const mg = res.venues.find((v) => v.name === "Magazzini Generali")!;
  assert.equal(mg.lat, 45.4441);
  assert.equal(mg.lon, 9.1953);
  assert.equal(mg.city, "MILANO");
  assert.equal(mg.source, "ticketmaster");
  assert.ok(mg.address?.includes("Via Pietrasanta 16"));
  assert.ok(res.venues.some((v) => v.name === "Alcatraz"));
  assert.ok(res.venues.some((v) => v.name === "Circolo Senza Geo" && v.lat === null));
  assert.ok(!res.venues.some((v) => v.name === "Venue Tokyo"));
});

const ARCI_SEARCH = `<html><form>
<select name="regione"><option value="">--- Regione ---</option><option value="9">Lombardia</option></select>
<select name="comitato"><option value="">--- Comitato ---</option><option value="77">ARCI MILANO - LO - MB</option></select>
</form>
<a href="/dettaglio/circolo/2108/itaca/">Vedi scheda Circolo</a>
<a href="/dettaglio/circolo/3284/caposelvi/">Vedi scheda Circolo</a>
</html>`;

const ARCI_SEARCH_P2 = `<html><form><select name="comitato"></select></form><p>Fine résultats</p></html>`;

const ARCI_DETAIL_MI = `<html><body><h1>CIRCOLO ARCI ITACA APS</h1><p>Sede legale <strong>VIA Capuana, 7 - 20157 MILANO MI</strong> (Sede legale)</p></body></html>`;
const ARCI_DETAIL_AR = `<html><body><h1>CIRCOLO ARCI CAPOSELVI APS</h1><p>Sede legale <strong>VIA DI CAPOSELVI, 242 - 52025 Montevarchi AR</strong></p></body></html>`;

test("arci circoli source: filtro comitato Milano dal form, schede dettaglio, solo provincia MI", async () => {
  const urls: string[] = [];
  const mockFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    urls.push(u);
    if (u.includes("/dettaglio/circolo/2108/")) return new Response(ARCI_DETAIL_MI, { status: 200 });
    if (u.includes("/dettaglio/circolo/3284/")) return new Response(ARCI_DETAIL_AR, { status: 200 });
    if (u.includes("p=2")) return new Response(ARCI_SEARCH_P2, { status: 200 });
    if (u.includes("cerca/circolo")) return new Response(ARCI_SEARCH, { status: 200 });
    return new Response("<html></html>", { status: 200 });
  }) as typeof fetch;
  const res = await arciCircoliSource.run({ fetchImpl: mockFetch, limits: { arciPages: 3, arciDetails: 10 }, env: {}, now: () => "2026-11-01T00:00:00Z" });
  assert.ok(urls.some((u) => u.includes("cerca/circolo") && u.includes("comitato=77")));
  assert.equal(res.venues.length, 1);
  const itaca = res.venues[0];
  assert.equal(itaca.name, "CIRCOLO ARCI ITACA APS");
  assert.equal(itaca.address, "VIA Capuana, 7, 20157 MILANO MI");
  assert.equal(itaca.city, "MILANO");
  assert.equal(itaca.lat, null);
  assert.equal(itaca.source, "arci");
  assert.ok(itaca.url?.includes("/dettaglio/circolo/2108/"));
});

test("parseArciDetail: estrae sede legale MI, ignora altre province", () => {
  const mi = parseArciDetail(ARCI_DETAIL_MI, "https://portale.arci.it/dettaglio/circolo/2108/itaca/");
  assert.ok(mi && mi.city === "MILANO" && mi.address?.includes("20157"));
  assert.equal(parseArciDetail(ARCI_DETAIL_AR, "https://portale.arci.it/dettaglio/circolo/3284/caposelvi/"), null);
  assert.equal(parseArciDetail("<html><h1>X</h1></html>", "u"), null);
});

test("pin Magazzini Generali corretto (Via Pietrasanta 16)", () => {
  const mg = pinForVenue("Magazzini Generali");
  assert.ok(mg);
  assert.equal(mg.lat, 45.4441);
  assert.equal(mg.lon, 9.1953);
  assert.equal(mg.address, "Via Pietrasanta 16, 20141 Milano");
  assert.equal(pinForVenue("Magazzini Generali Milano")?.lon, 9.1953);
});

function fakeVenueSource(id: string, venues: VenueDraft[]): VenueSource {
  return { id, async run() { return { sourceId: id, venues }; } };
}

test("runVenueSync: pin curato vince sulle coordinate della fonte, dedup per nome (ci), fill coords/meta", async () => {
  const db = openDb(":memory:");
  const venues = createVenueRepository(db);
  const src = fakeVenueSource("fake", [
    { name: "Magazzini Generali", address: "Via Pietrasanta 16, Milano", city: "MILANO", lat: 45.0, lon: 9.0, source: "fake", url: null },
    { name: "Club Nuovo", address: "Via Test 1, Milano", city: "MILANO", lat: 45.47, lon: 9.19, source: "fake", url: null },
    { name: "club nuovo", address: null, city: "MILANO", lat: null, lon: null, source: "arci", url: null },
    { name: "Bar X", address: "Via Bar 3, Milano", city: "MILANO", lat: 45.5, lon: 9.2, source: "fake", url: null },
  ]);
  const pre = venues.upsertVenue({ name: "Bar X", address: null, city: "MILANO" }, "2026-11-01T00:00:00Z");
  assert.equal(pre.lat, null);
  const res = await runVenueSync({ venues, extraVenueSources: [src] }, {});
  assert.equal(res.errors.length, 0);
  assert.equal(res.venuesSynced, 4);
  const mg = venues.findByName("Magazzini Generali")!;
  assert.equal(mg.lat, 45.4441);
  assert.equal(mg.lon, 9.1953);
  const club = venues.findByName("Club Nuovo")!;
  assert.equal(club.lat, 45.47);
  const bar = venues.findByName("Bar X")!;
  assert.equal(bar.lat, 45.5);
  assert.equal(bar.address, "Via Bar 3, Milano");
  const list = venues.listVenues() as { name: string }[];
  assert.equal(list.length, 3);
});

test("runSync: fase venue prima degli eventi -> zero geocode per venue seeded", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  const geocodeCalls: string[] = [];
  const geocoder = { async geocode(q: string) { geocodeCalls.push(q); return { lat: 45.5741, lon: 9.1635 }; } };
  const seed: VenueSource = fakeVenueSource("seed", [
    { name: "Spazio Test", address: "Via Test 5, Milano", city: "MILANO", lat: 45.46, lon: 9.2, source: "seed", url: null },
  ]);
  const draft: EventDraft = {
    sourceId: "ev", sourceName: "Ev", title: "SERATA", description: null,
    start: "2026-11-05", end: null, timeStart: "21:00", timeEnd: null,
    url: "https://example.org/serata", venue: "Spazio Test", address: "Via Test 5, Milano",
    city: "MILANO", lat: null, lon: null, organizer: null,
  };
  const evSrc: EventSource = { id: "ev", async run(): Promise<SourceResult> { return { sourceId: "ev", events: [draft] }; } };
  const res = await runSync(
    { events, venues, geocoder, extraSources: [evSrc], extraVenueSources: [seed] },
    { geocode: true, geocodeSleepMs: 0, env: {} },
  );
  assert.equal(res.errors.length, 0);
  assert.equal(res.venuesSynced, 1);
  assert.equal(res.geocoded, 0);
  assert.equal(geocodeCalls.length, 0);
  const all = events.listEvents({ all: true });
  assert.equal(all.events[0].lat, 45.46);
  assert.equal(all.events[0].lon, 9.2);

  const res2 = await runSync(
    { events, venues, geocoder, extraSources: [evSrc], extraVenueSources: [seed] },
    { geocode: true, geocodeSleepMs: 0, env: {}, syncVenues: false },
  );
  assert.equal(res2.venuesSynced, 0);
});

test("ticketmaster events source: radius 100km, mapping venue con coordinate, filtro provincia", async () => {
  const srcs = ticketingSources({ TICKETING_SOURCES: "1", TICKETMASTER_API_KEY: "K" });
  const tm = srcs.find((s) => s.id === "ticketmaster")!;
  const urls: string[] = [];
  const mockFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    urls.push(u);
    return new Response(
      JSON.stringify({
        _embedded: {
          events: [
            { name: "Concerto Test", url: "https://tm/e/1", info: "info", dates: { start: { localDate: "2026-11-20", localTime: "21:00" } }, _embedded: { venues: [{ name: "Alcatraz", address: { line1: "Via Valtellina 25" }, city: { name: "Milano" }, location: { latitude: "45.4946", longitude: "9.1825" } }] } },
            { name: "Evento Tokyo", url: "https://tm/e/2", dates: { start: { localDate: "2026-11-21" } }, _embedded: { venues: [{ name: "X", city: { name: "Tokyo" }, location: { latitude: "35.6", longitude: "139.7" } }] } },
          ],
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const res = await tm.run(makeCtx({ fetchImpl: mockFetch }));
  assert.ok(urls[0].includes("events.json"));
  assert.ok(urls[0].includes("radius=100&unit=km"));
  assert.ok(/startDateTime=\d{4}-\d{2}-\d{2}T\d{2}%3A\d{2}%3A\d{2}Z/.test(urls[0]) || /startDateTime=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.test(decodeURIComponent(urls[0])));
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].title, "Concerto Test");
  assert.equal(res.events[0].venue, "Alcatraz");
  assert.equal(res.events[0].lat, 45.4946);
  assert.equal(res.events[0].timeStart, "21:00");
  assert.equal(res.events[0].sourceId, "ticketmaster");
});

test("eventbrite source (gate EVENTBRITE_SEARCH=1): within 100km, expand venue+organizer, mapping e filtri", async () => {
  const srcs = ticketingSources({ TICKETING_SOURCES: "1", EVENTBRITE_USER_TOKEN: "T", EVENTBRITE_SEARCH: "1" });
  const eb = srcs.find((s) => s.id === "eventbrite")!;
  const urls: string[] = [];
  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    urls.push(u);
    assert.equal((init?.headers as Record<string, string>)?.Authorization, "Bearer T");
    return new Response(
      JSON.stringify({
        events: [
          { name: { text: "Festa in piazza" }, url: "https://eb/1", start: { local: "2026-11-20T21:00:00", utc: "2026-11-20T20:00:00Z" }, end: { local: "2026-11-20T23:00:00" }, description: { text: "d" }, venue: { name: "Fabrique", latitude: "45.4593", longitude: "9.2255", address: { localized_address_display: "Via Fantoli 28, 20138 Milano", city: "Milano" } }, organizer: { name: "Org Test" } },
          { name: { text: "Roma" }, url: "https://eb/2", start: { local: "2026-11-20T21:00:00" }, venue: { latitude: "41.9", longitude: "12.5" } },
          { name: { text: "Fuori finestra" }, url: "https://eb/3", start: { local: "2027-01-10T21:00:00" }, venue: { latitude: "45.46", longitude: "9.19" } },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const res = await eb.run(makeCtx({ fetchImpl: mockFetch }));
  assert.ok(urls[0].includes("location.within=100km"));
  assert.ok(urls[0].includes("expand=venue,organizer"));
  assert.equal(res.events.length, 1);
  const e = res.events[0];
  assert.equal(e.title, "Festa in piazza");
  assert.equal(e.venue, "Fabrique");
  assert.equal(e.lat, 45.4593);
  assert.equal(e.lon, 9.2255);
  assert.equal(e.city, "MILANO");
  assert.equal(e.start, "2026-11-20");
  assert.equal(e.end, "2026-11-20");
  assert.equal(e.timeStart, "21:00");
  assert.equal(e.organizer, "Org Test");
  assert.equal(e.sourceId, "eventbrite");
});

test("coordsFor: match esatto ci, per indirizzo e per contenimento nome (>=6 caratteri)", () => {
  const db = openDb(":memory:");
  const venues = createVenueRepository(db);
  const v = venues.upsertVenue({ name: "Magazzini Generali Milano", address: "Via Pietrasanta 16, 20141 Milano", city: "MILANO" }, "2026-01-01");
  venues.setVenueCoords(v.id, 45.4441, 9.1953);
  assert.equal(venues.coordsFor("magazzini generali milano", null)?.lat, 45.4441);
  assert.equal(venues.coordsFor("Magazzini Generali", null)?.lon, 9.1953);
  assert.equal(venues.coordsFor(null, "Via Pietrasanta 16")?.lat, 45.4441);
  assert.equal(venues.coordsFor("xy", null), null);
});
