import { test } from "node:test";
import assert from "node:assert/strict";
import { cheventiSource } from "../adapters/outbound/fetchers/cheventi.js";
import { tribeBaseSource } from "../adapters/outbound/fetchers/tribe.js";
import { lombardiaAreaPubblicaSource } from "../adapters/outbound/fetchers/lombardia-area-pubblica.js";
import { lombardiaSagreSource } from "../adapters/outbound/fetchers/lombardia.js";
import { wikidataSource } from "../adapters/outbound/fetchers/wikidata.js";
import { newsRssSources } from "../adapters/outbound/fetchers/news-rss.js";
import { ticketingSources, apiKeysFromEnv, bitArtistsFromEnv, DEFAULT_BIT_ARTISTS } from "../adapters/outbound/fetchers/ticketing.js";
import { milanotodaySource, milanotodayRangeUrl } from "../adapters/outbound/fetchers/milanotoday.js";
import { tribeEventiAtMilanoSource } from "../adapters/outbound/fetchers/tribe.js";
import type { SourceContext } from "../application/ports.js";

const CHEVENTI_LISTING = `<html><head><script type="application/ld+json">{"@type":"ItemList","itemListElement":[
{"@type":"ListItem","item":{"@type":"Event","name":"NODE &amp; more Slaughter Club, Paderno Dugnano (MI)","url":"https://www.cheventi.it/eventi/2026-node-more/","startDate":"2026-11-07T19:00:00+01:00","location":{"@type":"Place","name":"Slaughter Club","address":{"addressLocality":"Paderno Dugnano"},"geo":{"latitude":45.575565,"longitude":9.15202}}}},
{"@type":"ListItem","item":{"@type":"Event","name":"Evento a Tokyo","url":"https://www.cheventi.it/eventi/2026-tokyo/","startDate":"2026-12-01T21:00:00+09:00","location":{"@type":"Place","name":"X","address":{"addressLocality":"Tokyo"},"geo":{"latitude":35.6,"longitude":139.7}}}},
{"@type":"ListItem","item":{"@type":"Event","name":"Evento passato","url":"https://www.cheventi.it/eventi/2020-old/","startDate":"2020-01-01T21:00:00+01:00","location":{"@type":"Place","name":"Y","address":{"addressLocality":"Milano"}}}}
]}</script></head></html>`;

const RSS_NEWS = `<rss version="2.0"><channel>
<item><title>Oikos alla Fabbrica del Vapore per Danae Festival a Milano</title><link>https://vivimilano.corriere.it/x/</link><description><![CDATA[Spettacolo a Milano il 20 ottobre 2026.]]></description><pubDate>Tue, 20 Oct 2026 16:51:18 +0000</pubDate></item>
<item><title>Elezioni politiche a Roma</title><link>https://vivimilano.corriere.it/y/</link><description>Politica.</description><pubDate>Tue, 20 Oct 2026 10:00:00 +0000</pubDate></item>
</channel></rss>`;

function makeCtx(over: Partial<SourceContext>): SourceContext {
  return {
    fetchImpl: (async () => new Response("", { status: 200 })) as typeof fetch,
    fromDate: "2026-01-01",
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

test("milanotodayRangeUrl", () => {
  assert.equal(milanotodayRangeUrl("2026-11-01", "2026-12-01"), "https://www.milanotoday.it/eventi/dal/2026-11-01/al/2026-12-01/");
});

test("cheventi source: keeps only future in-province events", async () => {
  const mockFetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("cheventi.it")) return new Response(CHEVENTI_LISTING, { status: 200 });
    return new Response("<html></html>", { status: 200 });
  }) as typeof fetch;
  const res = await cheventiSource.run(makeCtx({ fetchImpl: mockFetch, limits: { cheventiPages: 1 } }));
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].venue, "Slaughter Club");
  assert.equal(res.events[0].lat, 45.575565);
  assert.equal(res.events[0].start, "2026-11-07");
});

const TRIBE_RESPONSE = {
  events: [
    {
      id: 1,
      url: "https://base.milano.it/event/bistrobrunch/2026-11-01/",
      title: "bistroBRUNCH",
      description: "<p>Brunch</p>",
      start_date: "2026-11-01 12:00:00",
      end_date: "2026-11-02 14:30:00",
      all_day: false,
      venue: { venue: "bistroBASE", address: "V. Ambrogio Bergognone da Fossano, 40", city: "Milano", province: "MI", zip: "20144" },
      organizer: [],
    },
    {
      id: 2,
      url: "https://base.milano.it/eventi/show-2026/",
      title: "Show vecchio",
      description: "",
      start_date: "2025-01-01 20:00:00",
      end_date: "2025-01-01 23:00:00",
      all_day: false,
      venue: false,
    },
    {
      id: 3,
      url: "https://base.milano.it/eventi/notte-2026/",
      title: "La notte ha la forma del grido di un lupo",
      description: "<p>Performance</p>",
      start_date: "2026-11-06 20:00:00",
      end_date: "2026-11-06 23:00:00",
      all_day: false,
      venue: { venue: "ROOM 2100" },
      organizer: [{ organizer: "BASE" }],
    },
  ],
  total: 3,
  total_pages: 1,
};

test("tribe source maps TEC events and filters window", async () => {
  const mockFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    assert.ok(u.includes("/wp-json/tribe/events/v1/events"));
    assert.ok(u.includes("start_date=2026-01-01"));
    assert.ok(u.includes("end_date=2026-12-31"));
    return new Response(JSON.stringify(TRIBE_RESPONSE), { status: 200 });
  }) as typeof fetch;
  const res = await tribeBaseSource.run(makeCtx({ fetchImpl: mockFetch }));
  assert.equal(res.events.length, 2);
  const brunch = res.events.find((e) => e.title === "bistroBRUNCH")!;
  assert.equal(brunch.start, "2026-11-01");
  assert.equal(brunch.end, "2026-11-02");
  assert.equal(brunch.timeStart, "12:00");
  assert.equal(brunch.timeEnd, "14:30");
  assert.equal(brunch.venue, "BASE Milano");
  assert.equal(brunch.address, "Via Tortona 40, 20144 Milano");
  assert.equal(brunch.city, "MILANO");
  assert.equal(brunch.lat, 45.4509);
  assert.equal(brunch.lon, 9.1587);
  assert.equal(brunch.sourceId, "tribe-base");
  const show = res.events.find((e) => e.title === "La notte ha la forma del grido di un lupo")!;
  assert.equal(show.venue, "BASE Milano");
  assert.equal(show.organizer, "BASE");
});

test("lombardia area pubblica: sagre con geo dal campo location", async () => {
  const rows = [
    {
      denom: "INVERART - PADIGLIONE D'ARTEGIOVANE INVERUNO",
      comune: "INVERUNO",
      prov: "MI",
      tipo: "Sagra",
      descriz: "Arte giovane",
      data_in: "2026-11-20T00:00:00.000",
      data_fine: "2026-11-22T00:00:00.000",
      toponimo: "VIA",
      indirizzo: "VIA MANZONI",
      geo_x: "8.85453709",
      geo_y: "45.51800375",
      location: { type: "Point", coordinates: [8.85453709, 45.51800375] },
      url_programma: { url: "https://www.procedimenti.servizirl.it/sagre/public/programma/26065" },
      nome_org: "COMUNE DI INVERUNO",
    },
    {
      denom: "Sagra senza geo",
      comune: "MILANO",
      prov: "MI",
      data_in: "2026-11-25T00:00:00.000",
      data_fine: null,
      toponimo: null,
      indirizzo: "PIAZZA DUOMO",
      geo_x: null,
      geo_y: null,
      location: null,
      url_programma: null,
      nome_org: null,
    },
    {
      denom: "Fuori provincia",
      comune: "ROMA",
      prov: "RM",
      data_in: "2026-11-25T00:00:00.000",
      geo_x: "12.5",
      geo_y: "41.9",
      location: { type: "Point", coordinates: [12.5, 41.9] },
    },
    {
      denom: "Senza data",
      comune: "MILANO",
      prov: "MI",
      data_in: null,
    },
  ];
  const mockFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    assert.ok(u.includes("hs8z-dcey.json"));
    assert.ok(decodeURIComponent(u).includes("upper(prov) = 'MI'"));
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as typeof fetch;
  const res = await lombardiaAreaPubblicaSource.run(makeCtx({ fetchImpl: mockFetch }));
  assert.equal(res.events.length, 2);
  const inverart = res.events.find((e) => e.title.startsWith("INVERART"))!;
  assert.equal(inverart.start, "2026-11-20");
  assert.equal(inverart.end, "2026-11-22");
  assert.equal(inverart.lat, 45.51800375);
  assert.equal(inverart.lon, 8.85453709);
  assert.equal(inverart.city, "INVERUNO");
  assert.equal(inverart.url, "https://www.procedimenti.servizirl.it/sagre/public/programma/26065");
  assert.equal(inverart.organizer, "COMUNE DI INVERUNO");
  const noGeo = res.events.find((e) => e.title === "Sagra senza geo")!;
  assert.equal(noGeo.lat, null);
  assert.equal(noGeo.lon, null);
  assert.equal(noGeo.address, "PIAZZA DUOMO, MILANO, MI");
});

test("wikidata source parses QLever bindings e filtra per bbox provincia MI", async () => {
  const mockFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    assert.ok(u.includes("P585"), "query con data obbligatoria");
    assert.ok(decodeURIComponent(u).includes("FILTER(?date >="), "filtro finestra server-side");
    return new Response(
      JSON.stringify({
        results: {
          bindings: [
            { event: { value: "http://www.wikidata.org/entity/Q1" }, label: { value: "Milano Music Week" }, coord: { value: "POINT(9.19 45.4642)" }, date: { value: "2026-11-16T00:00:00Z" }, end: { value: "2026-11-22T00:00:00Z" } },
            { event: { value: "http://www.wikidata.org/entity/Q2" }, label: { value: "Evento Tokyo" }, coord: { value: "POINT(139.7 35.6)" }, date: { value: "2026-11-16T00:00:00Z" } },
            { event: { value: "http://www.wikidata.org/entity/Q3" }, label: { value: "Evento Roma" }, coord: { value: "POINT(12.5 41.9)" }, date: { value: "2026-11-16T00:00:00Z" } },
          ],
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const res = await wikidataSource.run(makeCtx({ fetchImpl: mockFetch }));
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].title, "Milano Music Week");
  assert.equal(res.events[0].lat, 45.4642);
  assert.equal(res.events[0].lon, 9.19);
});

test("news RSS source filters event+Milano items", async () => {
  const mockFetch = (async () => new Response(RSS_NEWS, { status: 200 })) as typeof fetch;
  const res = await newsRssSources[0].run(makeCtx({ fetchImpl: mockFetch }));
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].start, "2026-10-20");
  assert.equal(res.events[0].sourceName, "ViviMilano Spettacoli");
});

test("milanotoday source walks listing -> detail JSON-LD (href anche con apici singoli) + prezzo dal testo", async () => {
  const listing = `<html><a href='/eventi/wunder-mrkt-2026.html'>x</a><a href="/eventi/altra.html">y</a></html>`;
  const detail = `<html><body><p>Prezzo: ingresso libero</p><script type="application/ld+json">{"@type":"Event","name":"Wunder Mrkt","startDate":"2026-11-01","url":"https://wundermrkt.com/","location":{"name":"Spazio Profumo","address":"Via Binda 29, Milano"}}</script></body></html>`;
  const detailPaid = `<html><body><p>Biglietto da 15 euro</p><script type="application/ld+json">{"@type":"Event","name":"Altra","startDate":"2026-11-02","url":"https://altra.com/","location":{"name":"Circolo","address":"Via Roma 1, Milano"}}</script></body></html>`;
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Eventi</title>
<item><title>x</title><link>https://www.milanotoday.it/eventi/da-rss-2026.html</link></item>
</channel></rss>`;
  const detailRss = `<html><script type="application/ld+json">{"@type":"Event","name":"Da RSS","startDate":"2026-11-05","url":"https://rss.com/","location":{"name":"Circolo Rss","address":"Via Rss 1, Milano"}}</script></html>`;
  const mockFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes("rss/channels/eventi")) return new Response(rss, { status: 200 });
    if (u.includes("/eventi/dal/")) return new Response(listing, { status: 200 });
    if (u.includes("wunder-mrkt")) return new Response(detail, { status: 200 });
    if (u.includes("altra.html")) return new Response(detailPaid, { status: 200 });
    if (u.includes("da-rss-2026")) return new Response(detailRss, { status: 200 });
    return new Response("<html></html>", { status: 200 });
  }) as typeof fetch;
  const res = await milanotodaySource.run(makeCtx({ fetchImpl: mockFetch, limits: { milanotodayDetails: 8 } }));
  assert.equal(res.events.length, 3);
  assert.ok(res.events.some((e) => e.title === "Da RSS"));
  const wunder = res.events.find((e) => e.title === "Wunder Mrkt")!;
  assert.equal(wunder.venue, "Spazio Profumo");
  assert.equal(wunder.priceMin, 0);
  assert.equal(wunder.priceMax, 0);
  const altra = res.events.find((e) => e.title === "Altra")!;
  assert.equal(altra.priceMin, 15);
  assert.equal(altra.priceMax, 15);
});

test("tribe eventiatmilano: lookback recupera mostre lunghe in sovrapposizione; pagina 404 non azzera; cost -> prezzo", async () => {
  const page1 = {
    events: [
      { id: 1, url: "https://www.eventiatmilano.it/evento/mostra-lunga/", title: "Mostra lunga", start_date: "2026-09-01 10:00:00", end_date: "2027-01-31 18:00:00", cost: "12" },
      { id: 2, url: "https://www.eventiatmilano.it/evento/show/", title: "Show in finestra", start_date: "2026-11-10 20:00:00", end_date: "2026-11-10 23:00:00", cost: "Gratis" },
      { id: 3, url: "https://www.eventiatmilano.it/evento/dopo/", title: "Dopo finestra", start_date: "2026-12-01 20:00:00", end_date: "2026-12-01 23:00:00", cost: "30" },
      { id: 4, url: "https://www.eventiatmilano.it/evento/finita/", title: "Finita prima", start_date: "2026-09-01 10:00:00", end_date: "2026-10-01 18:00:00" },
    ],
    total: 4,
    total_pages: 1,
  };
  const mockFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    assert.ok(u.includes("start_date="));
    assert.ok(!u.includes("end_date="));
    return new Response(JSON.stringify(page1), { status: 200 });
  }) as typeof fetch;
  const res = await tribeEventiAtMilanoSource.run(makeCtx({ fetchImpl: mockFetch, fromDate: "2026-11-03", toDate: "2026-11-18" }));
  assert.equal(res.events.length, 2);
  const mostra = res.events.find((e) => e.title === "Mostra lunga")!;
  assert.equal(mostra.priceMin, 12);
  assert.equal(mostra.priceMax, 12);
  const show = res.events.find((e) => e.title === "Show in finestra")!;
  assert.equal(show.priceMin, 0);
  assert.equal(show.priceMax, 0);
});

test("tribe: pagina con meno righe di per_page ma total_pages>1 viene comunque percorsa (TEC capa a 50 righe)", async () => {
  const mk = (tag: string, n: number) => Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    url: `https://base.milano.it/event/${tag}-${i}/`,
    title: `Evento ${tag}-${i}`,
    start_date: "2026-11-10 20:00:00",
    end_date: "2026-11-10 23:00:00",
  }));
  const mockFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    const page = Number(new URL(u).searchParams.get("page"));
    if (page === 1) return new Response(JSON.stringify({ events: mk("p1", 50), total: 60, total_pages: 2 }), { status: 200 });
    if (page === 2) return new Response(JSON.stringify({ events: mk("p2", 10), total: 60, total_pages: 2 }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const res = await tribeBaseSource.run(makeCtx({ fetchImpl: mockFetch, fromDate: "2026-11-03", toDate: "2026-11-18" }));
  assert.equal(res.events.length, 60);
});

test("tribe: pagina fuori range (404) interrompe senza perdere gli eventi gia raccolti", async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    url: `https://base.milano.it/event/e${i}/`,
    title: `Evento ${i}`,
    start_date: "2026-11-10 20:00:00",
    end_date: "2026-11-10 23:00:00",
  }));
  const mockFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    const page = Number(new URL(u).searchParams.get("page"));
    if (page === 1) return new Response(JSON.stringify({ events: full, total: 150, total_pages: 2 }), { status: 200 });
    return new Response(JSON.stringify({ code: "event-archive-page-not-found", message: "no", data: { status: 404 } }), { status: 404 });
  }) as typeof fetch;
  const res = await tribeBaseSource.run(makeCtx({ fetchImpl: mockFetch, fromDate: "2026-11-03", toDate: "2026-11-18" }));
  assert.equal(res.events.length, 100);
});

test("ticketing sources off di default (TICKETING_SOURCES=1) e solo con chiavi; bandsintown artist-based", async () => {
  assert.equal(ticketingSources({}).length, 0);
  assert.equal(ticketingSources({ TICKETMASTER_API_KEY: "K" }).length, 0);
  assert.equal(ticketingSources({ TICKETING_SOURCES: "1" }).length, 0);
  assert.equal(ticketingSources({ TICKETING_SOURCES: "1", TICKETMASTER_API_KEY: "K" }).length, 1);
  assert.equal(ticketingSources({ TICKETING_SOURCES: "1", EVENTBRITE_USER_TOKEN: "T" }).length, 0);
  assert.equal(ticketingSources({ TICKETING_SOURCES: "1", EVENTBRITE_USER_TOKEN: "T", EVENTBRITE_SEARCH: "1" }).length, 1);
  const bit = ticketingSources({ TICKETING_SOURCES: "1", BANDSINTWN_APP_ID: "A" });
  assert.equal(bit.length, 1);
  assert.equal(bit[0].id, "bandsintown");

  const mockFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    assert.ok(u.includes("app_id=A"));
    if (u.includes("/artists/Coez/")) {
      return new Response(JSON.stringify([
        { datetime: "2026-11-16T21:00:00", url: "https://bit/e/1", artists: [{ name: "Coez" }], venue: { name: "Arcimboldi", city: "Milano", latitude: "45.5086", longitude: "9.2166" } },
        { datetime: "2026-12-01T21:00:00", artists: [{ name: "Coez" }], venue: { name: "Y", city: "Tokyo", latitude: "35.6", longitude: "139.7" } },
        { datetime: "2025-01-01T21:00:00", artists: [{ name: "Coez" }], venue: { name: "Z", city: "Milano" } },
      ]), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  }) as typeof fetch;
  const res = await bit[0].run(makeCtx({ fetchImpl: mockFetch, limits: { bitArtists: 5 }, env: { BANDSINTWN_ARTISTS: "Coez" } }));
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].title, "Coez in concerto");
  assert.equal(res.events[0].lat, 45.5086);
});

test("ticketmaster/eventbrite/bandsintown: drop events without coords inside provincia MI", async () => {
  const { ticketingSources } = await import("../adapters/outbound/fetchers/ticketing.js");
  const srcs = ticketingSources({ TICKETING_SOURCES: "1", TICKETMASTER_API_KEY: "K", EVENTBRITE_USER_TOKEN: "T", EVENTBRITE_SEARCH: "1", BANDSINTWN_APP_ID: "A" });
  const tm = srcs.find((s) => s.id === "ticketmaster")!;
  const mockFetch = (async () =>
    new Response(JSON.stringify({
      _embedded: { events: [
        { name: "Yung Kai Singapore", dates: { start: { localDate: "2026-11-10" } }, _embedded: { venues: [{ name: "Singapore Expo", location: { latitude: "1.33", longitude: "103.9" } }] } },
        { name: "Evento senza venue", dates: { start: { localDate: "2026-11-10" } } },
        { name: "Coez Arcimboldi", dates: { start: { localDate: "2026-11-16" } }, _embedded: { venues: [{ name: "Arcimboldi", city: { name: "Milano" }, location: { latitude: "45.5086", longitude: "9.2166" } }] } },
      ] },
    }), { status: 200 })) as typeof fetch;
  const ctx = { fetchImpl: mockFetch, fromDate: "2026-11-03", toDate: "2026-11-18", geocode: false, geocodeSleepMs: 0, maxGeocode: 0, limits: {}, env: {}, venues: {} as never, geocoder: { async geocode() { return null; } }, now: () => "2026-11-03T00:00:00Z" };
  const res = await tm.run(ctx as never);
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].title, "Coez Arcimboldi");
});

test("env helpers", () => {
  const k = apiKeysFromEnv({ TICKETMASTER_API_KEY: " abc ", EVENTBRITE_USER_TOKEN: "" });
  assert.equal(k.ticketmaster, "abc");
  assert.equal(k.eventbriteUser, undefined);
  assert.deepEqual(bitArtistsFromEnv({ BANDSINTWN_ARTISTS: " Coez , Mahmood ,, " }), ["Coez", "Mahmood"]);
  assert.ok(DEFAULT_BIT_ARTISTS.length >= 40);
});

test("lombardia-sagre: stessa sagra con doppia location/comune (Cornaredo->Paderno) -> stesso _id", async () => {
  const base = {
    istat: null, comune: "SENAGO", prov: "MI", denom: "CALDARROSTE DI SENAGO", tipo: null, n_ediz: null,
    descriz: null, data_in: "2026-11-07", ora_in: null, data_fine: "2026-11-08", ora_fine: null,
    cap: "20030", somminis: null, sito_web: null, url_programma: null, nome_org: "Pro Loco",
  };
  const rows = [
    { ...base, toponimo: "Piazza A", indirizzo: "Via Roma", civico: "1" },
    { ...base, toponimo: "Piazza B", indirizzo: "Via Milano", civico: "22", comune: "PADERNO DUGNANO" },
  ];
  const mockFetch = (async () => new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  const res = await lombardiaSagreSource.run(makeCtx({ fetchImpl: mockFetch, fromDate: "2026-11-01", toDate: "2026-11-30" }));
  assert.equal(res.events.length, 2);
  assert.equal(res.events[0]._id, res.events[1]._id);
});
