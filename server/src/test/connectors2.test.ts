import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractJsonLdEvents,
  extractEventLinks,
  extractDateFromText,
  parseRssItems,
  fetchCheventiEvents,
  fetchWikidataEvents,
  fetchNewsRssEvents,
  toMiEvent,
} from "../connectors2.js";
import { fetchTicketmasterEvents, fetchEventbriteEvents, fetchBandsintownEvents, apiKeysFromEnv, bitArtistsFromEnv } from "../connectors3.js";
import { queryEvents } from "../query.js";
import { openDb } from "../db.js";
import { syncEvents } from "../sync.js";

const CHEVENTI_LISTING = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
{"@type":"ListItem","position":1,"item":{"@type":"Event","@id":"https://www.cheventi.it/eventi/2026-node-more/#main","name":"NODE &amp; more Slaughter Club, Paderno Dugnano (MI)","url":"https://www.cheventi.it/eventi/2026-node-more-slaughter-club-paderno-dugnano-mi/","description":"Festival metal 💰 10€","startDate":"2026-11-07T19:00:00+01:00","endDate":"2026-11-08T04:00:00+01:00","location":{"@type":"Place","name":"Slaughter Club","address":{"@type":"PostalAddress","streetAddress":"Via Angelo Tagliabue 4","addressLocality":"Paderno Dugnano","postalCode":"20037"},"geo":{"@type":"GeoCoordinates","latitude":45.575565,"longitude":9.15202}}}},
{"@type":"ListItem","position":2,"item":{"@type":"Event","name":"Marco Masini Palasport 2026 Milano","url":"https://www.cheventi.it/eventi/marco-masini-palasport-2026-milano/","startDate":"2026-11-03T20:30:00+01:00","location":{"@type":"Place","name":"Unipol Forum","address":{"addressLocality":"Assago"}}}}
]}</script></head><body>
<a href="https://www.cheventi.it/eventi/2026-node-more-slaughter-club-paderno-dugnano-mi/">x</a>
<a href="/eventi/2026-sergio-cammariere-tour-milano-mi/">y</a>
</body></html>`;

const RSS_NEWS = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title>Oikos alla Fabbrica del Vapore per Danae Festival a Milano</title><link>https://vivimilano.corriere.it/concerti-e-spettacoli/oikos-fabbrica-del-vapore/</link><description><![CDATA[Spettacolo teatrale a Milano il 20 ottobre 2026 alla Fabbrica del Vapore.]]></description><pubDate>Tue, 20 Oct 2026 16:51:18 +0000</pubDate><category>Spettacoli</category></item>
<item><title>Elezioni politiche a Roma: analisi</title><link>https://vivimilano.corriere.it/politica/elezioni-roma/</link><description>Politica nazionale.</description><pubDate>Tue, 20 Oct 2026 10:00:00 +0000</pubDate></item>
<item><title>Concerto dei Muse a San Siro: tutte le date del tour 2027</title><link>https://www.eventiatmilano.it/evento/muse-concerto/</link><description>Live a Milano, San Siro, il 15 giugno 2027.</description><pubDate>Sat, 20 Nov 2027 19:30:00 +0000</pubDate><category>concerti</category></item>
</channel></rss>`;

test("extractJsonLdEvents finds ItemList events with geo", () => {
  const evs = extractJsonLdEvents(CHEVENTI_LISTING);
  assert.equal(evs.length, 2);
  const node = evs.find((e) => e.name?.includes("NODE"));
  assert.ok(node);
  assert.equal(node.startDate, "2026-11-07T19:00:00+01:00");
});

test("extractEventLinks resolves relative /eventi/ links", () => {
  const links = extractEventLinks(CHEVENTI_LISTING, "https://www.cheventi.it/regioni/lombardia/milano/", /\/eventi\/[a-z0-9][^"]*$/i);
  assert.equal(links.length, 2);
  assert.ok(links.some((l) => l.includes("sergio-cammariere")));
});

test("extractDateFromText handles ISO, italian, dd/mm/yyyy", () => {
  assert.equal(extractDateFromText("il 7 novembre 2026"), "2026-11-07");
  assert.equal(extractDateFromText("07/11/2026"), "2026-11-07");
  assert.equal(extractDateFromText("2026-11-07T19:00:00"), "2026-11-07");
  assert.equal(extractDateFromText("nessuna data"), null);
});

test("parseRssItems extracts title/link/categories", () => {
  const items = parseRssItems(RSS_NEWS);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0].categories, ["Spettacoli"]);
});

test("fetchCheventiEvents maps JSON-LD ItemList to connector events with geo", async () => {
  const mockFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("cheventi.it/regioni")) return new Response(CHEVENTI_LISTING, { status: 200 });
    return new Response("<html></html>", { status: 200 });
  }) as typeof fetch;
  const events = await fetchCheventiEvents({ fetchImpl: mockFetch, maxPages: 1, delayMs: 0, from: "2026-01-01" });
  assert.equal(events.length, 2);
  const node = events.find((e) => e.title.includes("NODE"));
  assert.ok(node);
  assert.equal(node!.start, "2026-11-07");
  assert.equal(node!.timeStart, "19:00");
  assert.equal(node!.venue, "Slaughter Club");
  assert.equal(node!.city, "PADERNO DUGNANO");
  assert.equal(node!.lat, 45.575565);
  assert.equal(node!.lon, 9.15202);
  const m = toMiEvent(node!, "2026-11-01T00:00:00Z");
  assert.equal(m.province, "MI");
  assert.equal(m.source, "Cheventi.it");
  assert.equal(m.lat, 45.575565);
});

test("fetchCheventiEvents skips past events", async () => {
  const pastListing = CHEVENTI_LISTING.replace("2026-11-07", "2020-01-01").replace("2026-11-08", "2020-01-02").replace("2026-11-03", "2020-01-03");
  const mockFetch = (async () => new Response(pastListing, { status: 200 })) as typeof fetch;
  const events = await fetchCheventiEvents({ fetchImpl: mockFetch, maxPages: 1, delayMs: 0, from: "2026-01-01" });
  assert.equal(events.length, 0);
});

test("fetchWikidataEvents parses QLever SPARQL JSON with coords", async () => {
  const sparqlJson = {
    results: {
      bindings: [
        { event: { value: "http://www.wikidata.org/entity/Q1" }, label: { value: "Milano Music Week 2026" }, coord: { value: "POINT(9.19 45.4642)" }, date: { value: "2026-11-16T00:00:00Z" }, end: { value: "2026-11-22T00:00:00Z" } },
        { event: { value: "http://www.wikidata.org/entity/Q2" }, label: { value: "" }, coord: { value: "POINT(9.1 45.5)" }, date: { value: "2026-12-01T20:00:00Z" } },
      ],
    },
  };
  const mockFetch = (async () => new Response(JSON.stringify(sparqlJson), { status: 200 })) as typeof fetch;
  const events = await fetchWikidataEvents({ fetchImpl: mockFetch, from: "2026-01-01" });
  assert.equal(events.length, 2);
  assert.equal(events[0].title, "Milano Music Week 2026");
  assert.equal(events[0].start, "2026-11-16");
  assert.equal(events[0].end, "2026-11-22");
  assert.equal(events[0].lat, 45.4642);
  assert.equal(events[0].lon, 9.19);
});

test("fetchNewsRssEvents filters event+Milano items and extracts dates", async () => {
  const mockFetch = (async () => new Response(RSS_NEWS, { status: 200 })) as typeof fetch;
  const events = await fetchNewsRssEvents({
    fetchImpl: mockFetch,
    feedUrl: "https://example/feed/",
    sourceId: "test-news",
    sourceName: "Test News",
    from: "2026-01-01",
  });
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.sourceName === "Test News"));
  const oikos = events.find((e) => e.title.includes("Oikos"));
  assert.equal(oikos!.start, "2026-10-20");
  const muse = events.find((e) => e.title.includes("Muse"));
  assert.equal(muse!.start, "2027-06-15");
});

test("fetchBandsintownEvents queries artist endpoints and filters to province MI", async () => {
  const calls: string[] = [];
  const mockFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/artists/Coez/")) {
      return new Response(JSON.stringify([
        { id: "1", datetime: "2026-11-16T21:00:00", url: "https://bandsintown.com/e/1", artists: [{ name: "Coez" }], venue: { name: "Teatro degli Arcimboldi", city: "Milano", latitude: "45.5086", longitude: "9.2166", street_address: "Viale dell'Innovazione 1" } },
        { id: "2", datetime: "2025-01-01T21:00:00", artists: [{ name: "Coez" }], venue: { name: "X", city: "Milano" } },
        { id: "3", datetime: "2026-12-01T21:00:00", artists: [{ name: "Coez" }], venue: { name: "Y", city: "Tokyo", latitude: "35.6", longitude: "139.7" } },
      ]), { status: 200 });
    }
    if (url.includes("/artists/Mahmood/")) {
      return new Response(JSON.stringify([
        { id: "4", datetime: "2026-11-20T21:30:00", artists: [{ name: "Mahmood" }], venue: { name: "Alcatraz", city: "Milano", latitude: "45.4945", longitude: "9.1874" } },
      ]), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  }) as typeof fetch;
  const events = await fetchBandsintownEvents("APPID", { fetchImpl: mockFetch, artists: ["Coez", "Mahmood", "Inesistente"], from: "2026-01-01", delayMs: 0 });
  assert.equal(events.length, 2);
  assert.ok(calls.every((u) => u.includes("app_id=APPID") && u.includes("/events")));
  const coez = events.find((e) => e.title.includes("Coez"));
  assert.equal(coez!.start, "2026-11-16");
  assert.equal(coez!.timeStart, "21:00");
  assert.equal(coez!.venue, "Teatro degli Arcimboldi");
  assert.equal(coez!.lat, 45.5086);
  assert.equal(coez!.city, "MILANO");
  assert.ok(!events.some((e) => e.city === "TOKYO"));
  assert.ok(!events.some((e) => e.start === "2025-01-01"));
});

test("bitArtistsFromEnv parses comma list", () => {
  assert.deepEqual(bitArtistsFromEnv({ BANDSINTWN_ARTISTS: " Coez , Mahmood ,, " }), ["Coez", "Mahmood"]);
  assert.deepEqual(bitArtistsFromEnv({}), []);
});

test("apiKeysFromEnv reads only set keys", () => {
  const k = apiKeysFromEnv({ TICKETMASTER_API_KEY: " abc ", EVENTBRITE_TOKEN: "", BANDSINTWN_APP_ID: undefined });
  assert.equal(k.ticketmaster, "abc");
  assert.equal(k.eventbrite, undefined);
  assert.equal(k.bandsintown, undefined);
});

test("fetchTicketmasterEvents maps Discovery API payload", async () => {
  const payload = {
    _embedded: {
      events: [
        {
          name: "Coez live",
          url: "https://ticketmaster.it/coez",
          info: "Concerto a Milano",
          dates: { start: { localDate: "2026-11-16", localTime: "21:00:00" } },
          _embedded: { venues: [{ name: "Teatro degli Arcimboldi", city: { name: "Milano" }, address: { line1: "Viale dell'Innovazione 1" }, location: { latitude: "45.5086", longitude: "9.2166" } }] },
        },
      ],
    },
  };
  const mockFetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
  const events = await fetchTicketmasterEvents("KEY", { fetchImpl: mockFetch });
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Coez live");
  assert.equal(events[0].start, "2026-11-16");
  assert.equal(events[0].timeStart, "21:00:00");
  assert.equal(events[0].venue, "Teatro degli Arcimboldi");
  assert.equal(events[0].lat, 45.5086);
});

test("fetchEventbriteEvents maps search payload", async () => {
  const payload = {
    events: [
      {
        name: { text: "Milano Hi-Fi 2026" },
        url: "https://eventbrite.it/e/1",
        description: { text: "Fiera audio" },
        start: { local: "2026-10-03T10:00:00+02:00", utc: "2026-10-03T08:00:00Z" },
        end: { local: "2026-10-04T20:00:00+02:00" },
        venue: { name: "Fiera Milano", address: { city: "Rho", localized_address_display: "Rho (MI)" }, latitude: "45.52", longitude: "9.08" },
        organizer: { name: "Org" },
      },
    ],
  };
  const mockFetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
  const events = await fetchEventbriteEvents("TOKEN", { fetchImpl: mockFetch });
  assert.equal(events.length, 1);
  assert.equal(events[0].start, "2026-10-03");
  assert.equal(events[0].timeStart, "10:00");
  assert.equal(events[0].city, "RHO");
  assert.equal(events[0].lat, 45.52);
});

test("syncEvents runs all connectors with mocks and skips api-key ones without keys", async () => {
  const mockFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("dati.lombardia.it")) return new Response("[]", { status: 200 });
    if (url.includes("milanotoday.it/eventi/dal/")) return new Response("<html></html>", { status: 200 });
    if (url.includes("cheventi.it/regioni")) return new Response(CHEVENTI_LISTING, { status: 200 });
    if (url.includes("qlever")) return new Response(JSON.stringify({ results: { bindings: [] } }), { status: 200 });
    if (url.includes("santeria.milano.it/wp-json")) return new Response("[]", { status: 200 });
    if (url.includes("vivimilano") || url.includes("milanoevents") || url.includes("eventiatmilano")) return new Response(RSS_NEWS, { status: 200 });
    return new Response("<html></html>", { status: 200 });
  }) as typeof fetch;
  const db = openDb(":memory:");
  const result = await syncEvents(db, {
    fetchImpl: mockFetch,
    geocode: false,
    fromDate: "2026-01-01",
  });
  assert.ok(result.errors.every((e) => !e.includes("ticketmaster") && !e.includes("eventbrite") && !e.includes("bandsintown")));
  const all = queryEvents(db, { includePast: true });
  const sources = new Set(all.events.map((e) => e.source));
  assert.ok(sources.has("Cheventi.it"));
  assert.ok(sources.has("ViviMilano Spettacoli") || sources.has("MilanoEvents.it") || sources.has("Eventi@Milano"));
});
