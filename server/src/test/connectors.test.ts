import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseEventJsonLd,
  parseMilanotodayListing,
  milanotodayRangeUrl,
  connectorEventToMiEvent,
  fetchMilanotodayEvents,
} from "../connectors.js";
import { queryEvents } from "../query.js";
import { openDb } from "../db.js";
import { syncEvents } from "../sync.js";
import type { SagreRow } from "@mievents/shared";

const LISTING_HTML = `<html><body>
<a href="/eventi/wunder-mrkt-2026-mercatino-vintage-via-binda.html">Wunder Mrkt</a>
<a href="/eventi/milano-music-week-2026-programma.html">Music Week</a>
<a href="/eventi/location/milano/">Milano</a>
<a href="/cronaca/notizia.html">Cronaca</a>
<a href="https://www.milanotoday.it/eventi/jazzmi-2026-concerti-jazz-programma.html">JazzMi</a>
</body></html>`;

const DETAIL_HTML = `<html><head><script type="application/ld+json">[{"@type":"WebSite","name":"MilanoToday"},{"@context":"https://schema.org/","@type":"Event","name":"Wunder Mrkt mercatino vintage","startDate":"2026-11-01","endDate":"2026-11-01","url":"https://wundermrkt.com/","location":{"@type":"Place","name":"Spazio Profumo","address":"Via Ambrogio Binda, 29, Milano, Barona"},"description":"Mercatino vintage allo Spazio Profumo."}]</script></head></html>`;

test("parseMilanotodayListing keeps only /eventi/*.html detail pages", () => {
  const urls = parseMilanotodayListing(LISTING_HTML, "https://www.milanotoday.it/eventi/dal/2026-11-01/al/2026-11-30/");
  assert.equal(urls.length, 3);
  assert.ok(urls.every((u) => u.includes("/eventi/") && u.endsWith(".html")));
  assert.ok(urls.some((u) => u.includes("jazzmi")));
});

test("milanotodayRangeUrl builds dal/al URL", () => {
  assert.equal(
    milanotodayRangeUrl("2026-11-01", "2026-11-30"),
    "https://www.milanotoday.it/eventi/dal/2026-11-01/al/2026-11-30/",
  );
});

test("parseEventJsonLd extracts schema.org Event with venue/address/city", () => {
  const ev = parseEventJsonLd(DETAIL_HTML, "https://www.milanotoday.it/eventi/wunder-mrkt-2026.html");
  assert.ok(ev);
  assert.equal(ev.title, "Wunder Mrkt mercatino vintage");
  assert.equal(ev.start, "2026-11-01");
  assert.equal(ev.end, "2026-11-01");
  assert.equal(ev.venue, "Spazio Profumo");
  assert.match(ev.address ?? "", /Via Ambrogio Binda, 29/);
  assert.equal(ev.city, "MILANO");
  assert.equal(ev.url, "https://wundermrkt.com/");
});

test("parseEventJsonLd returns null without Event or startDate", () => {
  assert.equal(parseEventJsonLd("<html><script type=\"application/ld+json\">{\"@type\":\"WebSite\"}</script></html>", "https://x"), null);
  assert.equal(parseEventJsonLd("<html></html>", "https://x"), null);
});

test("connectorEventToMiEvent produces stable id and category", () => {
  const ev = parseEventJsonLd(DETAIL_HTML, "https://x")!;
  ev.sourceId = "milanotoday-eventi";
  ev.sourceName = "MilanoToday Eventi";
  const e = connectorEventToMiEvent(ev, "2026-11-01T00:00:00Z");
  assert.equal(e.id.length, 16);
  assert.equal(e.source, "MilanoToday Eventi");
  assert.equal(e.province, "MI");
  assert.equal(e.saved, false);
  const again = connectorEventToMiEvent(ev, "2026-11-02T00:00:00Z");
  assert.equal(again.id, e.id);
});

test("fetchMilanotodayEvents walks listing and details with mock fetch", async () => {
  const calls: string[] = [];
  const mockFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/eventi/dal/")) return new Response(LISTING_HTML, { status: 200 });
    if (url.includes("wunder-mrkt")) return new Response(DETAIL_HTML, { status: 200 });
    return new Response("<html></html>", { status: 200 });
  }) as typeof fetch;
  const events = await fetchMilanotodayEvents({ fetchImpl: mockFetch, maxPages: 1, maxDetails: 10, detailDelayMs: 0 });
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Wunder Mrkt mercatino vintage");
  assert.equal(events[0].sourceId, "milanotoday-eventi");
  assert.ok(calls.some((u) => u.includes("/eventi/dal/2026-")));
});

const sampleRow: SagreRow = {
  istat: "015066", comune: "Senago", prov: "MI", denom: "FESTA DELLA BIRRA", tipo: "Sagra",
  n_ediz: "7", descriz: "Musica e birra artigianale", data_in: "2026-09-25T00:00:00.000", ora_in: "19:00",
  data_fine: "2026-09-27T00:00:00.000", ora_fine: "23:59", toponimo: "PIAZZA", indirizzo: "TRICOLORE",
  civico: null, cap: "20030", somminis: "S", sito_web: null,
  url_programma: { url: "https://example.org/p/1", description: null }, nome_org: "Pro Loco",
};

test("syncEvents with milanotoday connector and no RSS news", async () => {
  const mockFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("dati.lombardia.it")) return new Response(JSON.stringify([sampleRow]), { status: 200 });
    if (url.includes("/eventi/dal/")) return new Response(LISTING_HTML, { status: 200 });
    if (url.includes("wunder-mrkt")) return new Response(DETAIL_HTML, { status: 200 });
    return new Response("<html></html>", { status: 200 });
  }) as typeof fetch;
  const db = openDb(":memory:");
  const result = await syncEvents(db, { fetchImpl: mockFetch, geocode: false, feeds: false });
  assert.equal(result.errors.length, 0);
  const all = queryEvents(db, { includePast: true });
  assert.equal(all.total, 2);
  const sources = all.events.map((e) => e.source).sort();
  assert.deepEqual(sources, ["MilanoToday Eventi", "dati.lombardia.it"]);
  const mt = all.events.find((e) => e.source === "MilanoToday Eventi");
  assert.equal(mt?.venue, "Spazio Profumo");
  assert.equal(mt?.city, "MILANO");
  assert.equal(mt?.start, "2026-11-01");
});
