import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFirstDate, parseRss, parseJsonLdEvents, feedItemToEvent, type FeedSource } from "../feeds.js";
import { ftsQuery, queryEvents } from "../query.js";
import { openDb } from "../db.js";
import { syncEvents } from "../sync.js";
import type { SagreRow } from "@mievents/shared";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<item>
  <title>Cosa fare a Milano questo weekend: concerto gratuito in Piazza Duomo</title>
  <link>https://www.milanotoday.it/eventi/weekend-1-novembre-2026.html</link>
  <description><![CDATA[Appuntamenti a Milano: <b>sagra della castagna</b> a Sesto San Giovanni, mostra al Castello Sforzesco dal 5 novembre 2026.]]></description>
  <pubDate>Sat, 01 Nov 2026 08:00:00 +0100</pubDate>
  <guid>https://www.milanotoday.it/eventi/weekend-1-novembre-2026.html</guid>
</item>
<item>
  <title>Notizia di cronaca: lite in centro</title>
  <link>https://www.milanotoday.it/cronaca/lite.html</link>
  <description>Cronaca nera.</description>
  <pubDate>Sat, 01 Nov 2026 09:00:00 +0100</pubDate>
  <guid>https://www.milanotoday.it/cronaca/lite.html</guid>
</item>
<item>
  <title>Festival del cinema a Monza, proiezioni dal 10/11/2026</title>
  <link>https://www.example.org/monza-film.html</link>
  <description>Festival cinematografico in provincia di Monza.</description>
  <pubDate>Sat, 01 Nov 2026 10:00:00 +0100</pubDate>
  <guid>https://www.example.org/monza-film.html</guid>
</item>
</channel>
</rss>`;

const source: FeedSource = { id: "test-rss", name: "Test", url: "https://example.org/rss", kind: "rss" };

test("parseRss extracts items with CDATA and entities", () => {
  const items = parseRss(RSS);
  assert.equal(items.length, 3);
  assert.match(items[0].description, /sagra della castagna/);
  assert.equal(items[0].pubDate, "Sat, 01 Nov 2026 08:00:00 +0100");
});

test("feedItemToEvent filters to event+Milano-area items with a date", () => {
  const items = parseRss(RSS);
  const events = items.map((i) => feedItemToEvent(i, source, "2026-11-01T00:00:00Z")).filter(Boolean);
  assert.equal(events.length, 2);
  const concert = events.find((e) => e!.title.includes("concerto"));
  assert.ok(concert);
  assert.equal(concert!.start, "2026-11-05");
  assert.equal(concert!.source, "Test");
  assert.ok(["concerto", "sagra", "mostra", "altro"].includes(concert!.category));
  const festival = events.find((e) => e!.title.includes("Monza"));
  assert.ok(festival);
  assert.equal(festival!.start, "2026-11-10");
});

test("extractFirstDate handles italian and ISO dates", () => {
  assert.equal(extractFirstDate("dal 5 novembre 2026"), "2026-11-05");
  assert.equal(extractFirstDate("dal 05/11/2026 al 7/11/2026"), "2026-11-05");
  assert.equal(extractFirstDate("2026-12-01T10:00:00"), "2026-12-01");
  assert.equal(extractFirstDate("nessuna data qui"), null);
});

test("parseJsonLdEvents extracts schema.org Event from MilanoToday-like page", () => {
  const html = `<html><head><script type="application/ld+json">[{"@type":"WebSite","name":"x"},{"@type":"Event","name":"Milano Music Week 2026","startDate":"2026-11-16","endDate":"2026-11-22","url":"https://www.milanomusicweek.it/","location":{"@type":"Place","name":"Milano","address":", Milano, "},"description":"Festival della musica a Milano"}]</script></head></html>`;
  const items = parseJsonLdEvents(html, "https://www.milanotoday.it/eventi/location/milano/");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Milano Music Week 2026");
  assert.equal(items[0].pubDate, "2026-11-16");
});

test("ftsQuery builds safe MATCH expressions", () => {
  assert.equal(ftsQuery("birra"), '"birra"*');
  assert.equal(ftsQuery("festa birra"), '"festa" AND "birra"*');
  assert.equal(ftsQuery('  "quoted*"  '), '"quoted"*');
  assert.equal(ftsQuery("   "), '""');
});

const sampleRow: SagreRow = {
  istat: "015066", comune: "Senago", prov: "MI", denom: "FESTA DELLA BIRRA", tipo: "Sagra",
  n_ediz: "7", descriz: "Musica e birra artigianale", data_in: "2026-09-25T00:00:00.000", ora_in: "19:00",
  data_fine: "2026-09-27T00:00:00.000", ora_fine: "23:59", toponimo: "PIAZZA", indirizzo: "TRICOLORE",
  civico: null, cap: "20030", somminis: "S", sito_web: null,
  url_programma: { url: "https://example.org/p/1", description: null }, nome_org: "Pro Loco",
};

function socrataFetch(rows: unknown[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("dati.lombardia.it")) {
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    return new Response(RSS, { status: 200, headers: { "Content-Type": "application/rss+xml" } });
  }) as typeof fetch;
}

test("queryEvents: empty/whitespace q returns all, invalid dates throw 400", async () => {
  const db = openDb(":memory:");
  await syncEvents(db, { fetchImpl: socrataFetch([sampleRow]), geocode: false, feeds: false });
  assert.equal(queryEvents(db, {}).total, 1);
  assert.equal(queryEvents(db, { q: "" }).total, 1);
  assert.equal(queryEvents(db, { q: "   " }).total, 1);
  assert.equal(queryEvents(db, { q: "birra" }).total, 1);
  assert.equal(queryEvents(db, { q: "BIRRA" }).total, 1);
  assert.equal(queryEvents(db, { q: "xyznotfound" }).total, 0);
  assert.throws(() => queryEvents(db, { from: "2026/09/01" }), /from/);
  assert.throws(() => queryEvents(db, { to: "not-a-date" }), /to/);
  assert.throws(() => queryEvents(db, { from: "2026-02-30" }), /from/);
  assert.throws(() => queryEvents(db, { to: "2026-13-01" }), /to/);
  assert.equal(queryEvents(db, { from: "2026-09-25", to: "2026-09-27" }).total, 1);
  assert.equal(queryEvents(db, { from: "2026-09-26" }).total, 0);
});

test("syncEvents ingests RSS feeds alongside Socrata", async () => {
  const db = openDb(":memory:");
  const result = await syncEvents(db, { fetchImpl: socrataFetch([sampleRow]), geocode: false });
  assert.equal(result.errors.length, 0);
  const all = queryEvents(db, {});
  assert.equal(all.total, 7);
  const feedEvents = all.events.filter((e) => ["MilanoToday", "Il Giorno", "Arci"].includes(e.source));
  assert.equal(feedEvents.length, 6);
});
