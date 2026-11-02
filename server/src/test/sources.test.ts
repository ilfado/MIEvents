import { test } from "node:test";
import assert from "node:assert/strict";
import { cheventiSource } from "../adapters/outbound/fetchers/cheventi.js";
import { wikidataSource } from "../adapters/outbound/fetchers/wikidata.js";
import { newsRssSources } from "../adapters/outbound/fetchers/news-rss.js";
import { ticketingSources, apiKeysFromEnv, bitArtistsFromEnv, DEFAULT_BIT_ARTISTS } from "../adapters/outbound/fetchers/ticketing.js";
import { milanotodaySource, milanotodayRangeUrl } from "../adapters/outbound/fetchers/milanotoday.js";
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

test("wikidata source parses QLever bindings", async () => {
  const mockFetch = (async () =>
    new Response(
      JSON.stringify({
        results: {
          bindings: [
            { event: { value: "http://www.wikidata.org/entity/Q1" }, label: { value: "Milano Music Week" }, coord: { value: "POINT(9.19 45.4642)" }, date: { value: "2026-11-16T00:00:00Z" }, end: { value: "2026-11-22T00:00:00Z" } },
          ],
        },
      }),
      { status: 200 },
    )) as typeof fetch;
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

test("milanotoday source walks listing -> detail JSON-LD", async () => {
  const listing = `<html><a href="/eventi/wunder-mrkt-2026.html">x</a></html>`;
  const detail = `<html><script type="application/ld+json">{"@type":"Event","name":"Wunder Mrkt","startDate":"2026-11-01","url":"https://wundermrkt.com/","location":{"name":"Spazio Profumo","address":"Via Binda 29, Milano"}}</script></html>`;
  const mockFetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes("/eventi/dal/")) return new Response(listing, { status: 200 });
    if (u.includes("wunder-mrkt")) return new Response(detail, { status: 200 });
    return new Response("<html></html>", { status: 200 });
  }) as typeof fetch;
  const res = await milanotodaySource.run(makeCtx({ fetchImpl: mockFetch, limits: { milanotodayDetails: 5 } }));
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].title, "Wunder Mrkt");
  assert.equal(res.events[0].venue, "Spazio Profumo");
});

test("ticketing sources only with keys; bandsintown artist-based mapping", async () => {
  assert.equal(ticketingSources({}).length, 0);
  assert.equal(ticketingSources({ TICKETMASTER_API_KEY: "K" }).length, 1);
  assert.equal(ticketingSources({ EVENTBRITE_TOKEN: "T" }).length, 1);
  const bit = ticketingSources({ BANDSINTWN_APP_ID: "A" });
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

test("env helpers", () => {
  const k = apiKeysFromEnv({ TICKETMASTER_API_KEY: " abc ", EVENTBRITE_TOKEN: "" });
  assert.equal(k.ticketmaster, "abc");
  assert.equal(k.eventbrite, undefined);
  assert.deepEqual(bitArtistsFromEnv({ BANDSINTWN_ARTISTS: " Coez , Mahmood ,, " }), ["Coez", "Mahmood"]);
  assert.ok(DEFAULT_BIT_ARTISTS.length >= 40);
});
