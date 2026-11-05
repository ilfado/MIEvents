import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, createEventRepository, createVenueRepository, venueId } from "../adapters/outbound/repositories/sqlite.js";
import { createServer } from "../adapters/inbound/http/server.js";
import { runSync, draftId } from "../application/services/sync.js";
import type { EventSource } from "../application/ports.js";
import type { SourceResult } from "../core/types.js";

const DRAFT = {
  sourceId: "test-src",
  sourceName: "Test Source",
  title: "FESTA DELLA BIRRA",
  description: "Sagra con musica e birra artigianale a Senago",
  start: "2026-11-05",  // dentro finestra 15gg da oggi (2026-11-02)
  end: "2026-11-07",
  timeStart: "19:00",
  timeEnd: "23:59",
  url: "https://example.org/festa",
  venue: "Piazza Tricolore",
  address: "Piazza Tricolore, Senago, MI",
  city: "SENAGO",
  lat: null,
  lon: null,
  organizer: "Pro Loco",
};

const PAST_DRAFT = { ...DRAFT, title: "EVENTO PASSATO", description: " Evento del 2020 ", start: "2020-01-01", end: "2020-01-02", url: "https://example.org/past" };

function testSource(events: SourceResult["events"], id = "test-src"): EventSource {
  return { id, async run(): Promise<SourceResult> { return { sourceId: id, events }; } };
}

function mockGeocoder() {
  const calls: string[] = [];
  return {
    calls,
    async geocode(q: string) {
      calls.push(q);
      return { lat: 45.5741, lon: 9.1635 };
    },
  };
}

test("sync persists drafts, geocodes once per venue, reports summary", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  const geocoder = mockGeocoder();
  const src = testSource([DRAFT, { ...DRAFT, title: "SECONDO EVENTO STESSO VENUE", url: "https://example.org/festa2", start: "2026-11-06" }]);
  const res = await runSync(
    { events, venues, geocoder, extraSources: [src] },
    { geocode: true, geocodeSleepMs: 0, env: {}, syncVenues: false },
  );
  assert.equal(res.errors.length, 0);
  assert.equal(res.inserted, 2);
  assert.equal(geocoder.calls.length, 1);
  const all = events.listEvents({ all: true });
  assert.equal(all.total, 2);
  assert.ok(all.events.every((e) => e.lat === 45.5741 && e.lon === 9.1635));
  assert.equal(all.events[0].category, "sagra");
  assert.equal(draftId(DRAFT).length, 16);
});

test("default window = oggi..+15d solo con geo; all=1 mostra tutto", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  await runSync(
    { events, venues, geocoder: mockGeocoder(), extraSources: [testSource([DRAFT, PAST_DRAFT])] },
    { env: {}, syncVenues: false },
  );
  assert.equal(events.listEvents({ all: true }).total, 2);
  assert.equal(events.listEvents({}).total, 1);  // default: solo finestra 15gg (il passato escluso), geo NON richiesto in lista
  assert.equal(events.listEvents({ from: "2020-01-01", all: true }).total, 2);
  const ranged = events.listEvents({ from: "2026-11-05", to: "2026-11-07" });
  assert.equal(ranged.total, 1);
  const rangedGeo = events.listEvents({ from: "2026-11-05", to: "2026-11-07", geoOnly: true });
  assert.equal(rangedGeo.total, 1);
  assert.ok(rangedGeo.events.every((e) => e.lat != null));
  const geoAll = events.listEvents({ all: true, geoOnly: true });
  assert.equal(geoAll.total, 2);
  assert.throws(() => events.listEvents({ from: "2026-02-30" }), /from/);
  assert.throws(() => events.listEvents({ bbox: "bad" }), /bbox/);
});

test("fts search, filters, saved toggle", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  await runSync({ events, venues, geocoder: mockGeocoder(), extraSources: [testSource([DRAFT, PAST_DRAFT])] }, { env: {}, syncVenues: false });
  assert.equal(events.listEvents({ q: "birra", all: true }).total, 1);
  assert.equal(events.listEvents({ q: "BIRRA", all: true }).total, 1);
  assert.equal(events.listEvents({ q: "   ", all: true }).total, 2);
  assert.equal(events.listEvents({ q: "nope", all: true }).total, 0);
  assert.equal(events.listEvents({ city: "senago", all: true }).total, 2);
  const ev = events.listEvents({ q: "birra", all: true }).events.find((e) => e.title === "FESTA DELLA BIRRA")!;
  assert.equal(ev.saved, false);
  assert.ok(events.setSaved(ev.id, true));
  assert.equal(events.listEvents({ savedOnly: true, all: true }).total, 1);
  assert.equal(events.listEvents({ category: "saved", all: true }).total, 1);
  assert.equal(events.getEvent(ev.id)?.saved, true);
  assert.ok(!events.setSaved("missing", true));
});

test("pinned source: no geocode consumed, venue persisted with coords", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  const geocoder = mockGeocoder();
  const pinned = { ...DRAFT, sourceId: "tribe-base", sourceName: "BASE Milano", venue: "BASE Milano", address: "Via Tortona 40, 20144 Milano", city: "MILANO", lat: 45.4509, lon: 9.1587, url: "https://base.milano.it/event/x/" };
  const src = testSource([pinned, { ...pinned, title: "EVENTO 2 STESSA LOCATION", url: "https://base.milano.it/event/y/", lat: 45.4509, lon: 9.1587 }], "tribe-base");
  const res = await runSync({ events, venues, geocoder, extraSources: [src] }, { geocode: true, geocodeSleepMs: 0, env: {}, syncVenues: false });
  assert.equal(res.errors.length, 0);
  assert.equal(res.inserted, 2);
  assert.equal(res.geocoded, 0);
  assert.equal(geocoder.calls.length, 0);
  const all = events.listEvents({ all: true });
  assert.ok(all.events.every((e) => e.lat === 45.4509 && e.lon === 9.1587 && e.venue === "BASE Milano"));
  const c = venues.coordsFor("BASE Milano", null);
  assert.equal(c?.lat, 45.4509);
  assert.equal(c?.lon, 9.1587);
  const vlist = venues.listVenues() as { name: string; lat: number | null; lon: number | null }[];
  assert.equal(vlist.length, 1);
  assert.equal(vlist[0].name, "BASE Milano");
  assert.equal(vlist[0].lat, 45.4509);
});

test("known venue pin wins over geocoder and is persisted", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  const geocoder = mockGeocoder();
  const duomo = { ...DRAFT, title: "CONCERTO AL DUOMO", venue: "Duomo di Milano", address: "Piazza del Duomo, Milano", city: "MILANO", url: "https://example.org/duomo" };
  const arcimboldi = { ...DRAFT, title: "SHOW ARCIMBOLDI", venue: "Teatro degli Arcimboldi", address: null, city: "MILANO", url: "https://example.org/tam" };
  const unknown = { ...DRAFT, title: "EVENTO BAR SCONOSCIUTO", venue: "Bar Pippo", address: "Via inventata 1, Milano", city: "MILANO", url: "https://example.org/bar" };
  await runSync(
    { events, venues, geocoder, extraSources: [testSource([duomo, arcimboldi, unknown])] },
    { geocode: true, geocodeSleepMs: 0, env: {}, syncVenues: false },
  );
  assert.equal(geocoder.calls.length, 1);
  assert.ok(geocoder.calls[0].includes("inventata"));
  const all = events.listEvents({ all: true });
  const byTitle = Object.fromEntries(all.events.map((e) => [e.title, e]));
  assert.equal(byTitle["CONCERTO AL DUOMO"].lat, 45.4642);
  assert.equal(byTitle["CONCERTO AL DUOMO"].lon, 9.19);
  assert.equal(byTitle["SHOW ARCIMBOLDI"].lat, 45.5086);
  assert.equal(byTitle["EVENTO BAR SCONOSCIUTO"].lat, 45.5741);
  const c = venues.coordsFor("Duomo di Milano", null);
  assert.equal(c?.lat, 45.4642);
  const tam = venues.coordsFor("Teatro degli Arcimboldi", null);
  assert.equal(tam?.lon, 9.2084);
});

test("venueId stable + coordsFor reuse", () => {
  const db = openDb(":memory:");
  const venues = createVenueRepository(db);
  const v1 = venues.upsertVenue({ name: "Spazio Profumo", address: "Via Binda 29, Milano", city: "Milano" }, "2026-11-01");
  const v2 = venues.upsertVenue({ name: "spazio profumo", address: "via binda 29, milano", city: "MILANO" }, "2026-11-02");
  assert.equal(v1.id, v2.id);
  assert.equal(venueId("A", null, "MILANO"), venueId("a", " ", "milano"));
  venues.setVenueCoords(v1.id, 45.4408, 9.1694);
  const c = venues.coordsFor("Spazio Profumo", null);
  assert.equal(c?.lat, 45.4408);
  assert.equal(c?.lon, 9.1694);
});

test("grandi eventi saltati in sync; prezzo dal testo persistito; filtro priceBand; big escluso di default", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  const big = { ...DRAFT, title: "CONCERTO STADIO", venue: "Stadio San Siro", address: "Piazzale dello Sport 5, Milano", city: "MILANO", url: "https://example.org/sansiro" };
  const cheap = { ...DRAFT, title: "DJ SET AL CIRCOLO", description: "Ingresso 8 euro", url: "https://example.org/dj", venue: "Circolo X", address: "Via inventata 2, Milano", city: "MILANO" };
  const free = { ...DRAFT, title: "MOSTRA GRATUITA", description: "Ingresso gratuito", url: "https://example.org/mostra", venue: "Circolo Y", address: "Via inventata 3, Milano", city: "MILANO" };
  const cari = { ...DRAFT, title: "SHOW CARO", description: "Biglietto da 45 euro", url: "https://example.org/caro", venue: "Circolo Z", address: "Via inventata 4, Milano", city: "MILANO" };
  const res = await runSync(
    { events, venues, geocoder: mockGeocoder(), extraSources: [testSource([big, cheap, free, cari])] },
    { env: {}, syncVenues: false, geocode: false },
  );
  assert.equal(res.skipped, 2);
  assert.equal(res.inserted, 2);
  const all = events.listEvents({ all: true });
  assert.equal(all.total, 2);
  const got = Object.fromEntries(all.events.map((e) => [e.title, e]));
  assert.equal(got["DJ SET AL CIRCOLO"].priceBand, "fino10");
  assert.equal(got["DJ SET AL CIRCOLO"].priceMin, 8);
  assert.equal(got["DJ SET AL CIRCOLO"].priceMax, 8);
  assert.equal(got["MOSTRA GRATUITA"].priceBand, "gratis");
  assert.equal(got["SHOW CARO"], undefined);
  assert.equal(events.listEvents({ all: true, priceBand: "gratis" }).total, 1);
  assert.equal(events.listEvents({ all: true, priceBand: "fino10" }).total, 2);
  assert.equal(events.listEvents({ all: true, priceBand: "fino20" }).total, 2);
  assert.equal(events.listEvents({ all: true, priceBand: "cari" }).total, 0);
  assert.throws(() => events.listEvents({ all: true, priceBand: "zzz" as never }), /priceBand/);
  events.upsertEvent({ ...big, id: "big1", category: "concerto", saved: false, fetchedAt: "2026-11-03T00:00:00Z" } as never);
  assert.equal(events.listEvents({ all: true }).total, 2);
  const withBig = events.listEvents({ all: true, includeBig: true });
  assert.equal(withBig.total, 3);
  assert.equal(withBig.events.find((e) => e.id === "big1")!.big, true);
});

test("draftId: _id esplicito evita collisioni stesso url/data (sagre stessa giornata)", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  const a = { ...DRAFT, _id: "aaaaaaaabbbbbbbb" };
  const b = { ...DRAFT, _id: "ccccccccdddddddd", title: "ALTRA SAGRA STESSA DATA" };
  const res = await runSync(
    { events, venues, geocoder: mockGeocoder(), extraSources: [testSource([a, b])] },
    { env: {}, syncVenues: false, geocode: false },
  );
  assert.equal(res.inserted, 2);
  assert.equal(events.listEvents({ all: true }).total, 2);
});

test("HTTP API end-to-end", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  await runSync({ events, venues, geocoder: mockGeocoder(), extraSources: [testSource([DRAFT, PAST_DRAFT])] }, { env: {}, syncVenues: false });
  const server = createServer({ db, webDist: "/nonexistent", events, venues });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const get = async (p: string) => {
      const res = await fetch(`http://127.0.0.1:${port}${p}`);
      return { status: res.status, body: await res.json() };
    };
    assert.deepEqual(await get("/api/health"), { status: 200, body: { ok: true } });
    const all = await get("/api/events?all=1");
    assert.equal(all.body.total, 2);
    const def = await get("/api/events");  // default: finestra 15gg + geo
    assert.equal(def.body.total, 1);
    const filtered = await get("/api/events?category=sagra&all=1");
    assert.equal(filtered.body.total, 1);
    const bad = await get("/api/events?category=zzz");
    assert.equal(bad.status, 400);
    const id = all.body.events[0].id;
    const saved = await fetch(`http://127.0.0.1:${port}/api/events/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved: true }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).saved, true);
    assert.equal((await get("/api/events?saved=1&all=1")).body.total, 1);
    const missing = await fetch(`http://127.0.0.1:${port}/api/events/nope`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved: true }),
    });
    assert.equal(missing.status, 404);
    const badBody = await fetch(`http://127.0.0.1:${port}/api/events/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved: "yes" }),
    });
    assert.equal(badBody.status, 400);
    assert.equal((await get("/api/events/nope")).status, 404);
    const cities = await get("/api/events/cities");
    assert.deepEqual(cities.body.cities, ["SENAGO"]);
    const badBand = await get("/api/events?priceBand=zzz&all=1");
    assert.equal(badBand.status, 400);
    assert.equal((await get("/api/events?limit=abc")).status, 400);
    assert.equal((await get("/api/events?offset=-1")).status, 400);
    assert.equal((await get("/api/events?limit=50")).status, 200);
    const badSync = await fetch(`http://127.0.0.1:${port}/api/sync?from=2026-13-99`, { method: "POST" });
    assert.equal(badSync.status, 400);
    const badSync2 = await fetch(`http://127.0.0.1:${port}/api/sync?from=' OR '1'='1`, { method: "POST" });
    assert.equal(badSync2.status, 400);
  } finally {
    server.close();
  }
});

test("static: CSP con tile OSM in connect-src/img-src, cache immutable su /assets, compressione gzip/br", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mievents-web-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>t</title>");
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "assets", "app-abc.js"), "console.log('x');".repeat(300));
  const db = openDb(":memory:");
  const server = createServer({ db, webDist: dir });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  try {
    const idx = await fetch(`http://127.0.0.1:${port}/`);
    const csp = idx.headers.get("content-security-policy") ?? "";
    assert.ok(csp.includes("connect-src 'self'"));
    assert.ok(csp.includes("script-src 'self'"));
    assert.ok(!csp.includes("https://"));
    assert.ok(!csp.includes("blob:"));
    assert.ok(csp.includes("img-src 'self' data:"));
    assert.equal(idx.headers.get("referrer-policy"), "no-referrer");
    assert.equal(idx.headers.get("cache-control"), "no-cache");
    const gz = await fetch(`http://127.0.0.1:${port}/assets/app-abc.js`, { headers: { "accept-encoding": "gzip" } });
    assert.equal(gz.headers.get("content-encoding"), "gzip");
    assert.equal(gz.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.ok((await gz.text()).includes("console.log"));
    const br = await fetch(`http://127.0.0.1:${port}/assets/app-abc.js`, { headers: { "accept-encoding": "br, gzip" } });
    assert.equal(br.headers.get("content-encoding"), "br");
    const plain = await fetch(`http://127.0.0.1:${port}/assets/app-abc.js`, { headers: { "accept-encoding": "identity" } });
    assert.equal(plain.headers.get("content-encoding"), null);
    assert.ok((await plain.text()).includes("console.log"));
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tile proxy /tiles/{z}/{x}/{y}.png: cache, retina, validazione path, upstream 502", async () => {
  let calls = 0;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
  const tileFetcher = (async () => {
    calls++;
    return new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
  }) as unknown as typeof fetch;
  const db = openDb(":memory:");
  const server = createServer({ db, webDist: "/nonexistent", tileFetcher });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  try {
    const t1 = await fetch(`http://127.0.0.1:${port}/tiles/10/512/340.png`);
    assert.equal(t1.status, 200);
    assert.equal(t1.headers.get("content-type"), "image/png");
    assert.equal(t1.headers.get("cache-control"), "public, max-age=86400");
    assert.deepEqual(Buffer.from(await t1.arrayBuffer()), png);
    const t2 = await fetch(`http://127.0.0.1:${port}/tiles/10/512/340.png`);
    assert.equal(t2.status, 200);
    assert.equal(calls, 1);
    const t3 = await fetch(`http://127.0.0.1:${port}/tiles/10/512/340@2x.png`);
    assert.equal(t3.status, 200);
    assert.equal(calls, 2);
    assert.equal((await fetch(`http://127.0.0.1:${port}/tiles/99/0/0.png`)).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${port}/tiles/10/9999/340.png`)).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${port}/tiles/10/512/340.jpg`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/tiles/../../etc.png`)).status, 404);
  } finally {
    server.close();
  }
});

test("tile proxy: fallback su secondo upstream (wikimedia 403 -> OSM ok), 502 se entrambi KO", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
  const seen: string[] = [];
  const tileFetcher = (async (url: any) => {
    const u = String(url);
    seen.push(u);
    if (u.includes("wikimedia")) return new Response("blocked", { status: 403 });
    return new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
  }) as unknown as typeof fetch;
  const db = openDb(":memory:");
  const server = createServer({ db, webDist: "/nonexistent", tileFetcher });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  try {
    const t = await fetch(`http://127.0.0.1:${port}/tiles/12/2200/1400.png`);
    assert.equal(t.status, 200);
    assert.deepEqual(Buffer.from(await t.arrayBuffer()), png);
    assert.equal(seen.length, 2);
    assert.ok(seen[0].includes("wikimedia"));
    assert.ok(seen[1].includes("tile.openstreetmap.org"));

    const allFail = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    const server2 = createServer({ db: openDb(":memory:"), webDist: "/nonexistent", tileFetcher: allFail });
    await new Promise<void>((r) => server2.listen(0, r));
    const port2 = (server2.address() as AddressInfo).port;
    try {
      const t2 = await fetch(`http://127.0.0.1:${port2}/tiles/12/2200/1401.png`);
      assert.equal(t2.status, 502);
    } finally {
      server2.close();
    }
  } finally {
    server.close();
  }
});

test("tile proxy: upstream 200 non-PNG (HTML) viene scartato, si passa al fallback; 502 se nessuno valido", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const html = Buffer.from("<!doctype html><title>blocked</title>");
  const mk = (mode: "html-first" | "all-html") =>
    (async (url: any) => {
      const u = String(url);
      if (mode === "html-first" && u.includes("wikimedia")) return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
      if (mode === "all-html") return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
      return new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
    }) as unknown as typeof fetch;
  const db = openDb(":memory:");
  const s1 = createServer({ db, webDist: "/nonexistent", tileFetcher: mk("html-first") });
  await new Promise<void>((r) => s1.listen(0, r));
  const p1 = (s1.address() as AddressInfo).port;
  try {
    const t = await fetch(`http://127.0.0.1:${p1}/tiles/11/1100/700.png`);
    assert.equal(t.status, 200);
    assert.deepEqual(Buffer.from(await t.arrayBuffer()), png);
  } finally {
    s1.close();
  }
  const s2 = createServer({ db: openDb(":memory:"), webDist: "/nonexistent", tileFetcher: mk("all-html") });
  await new Promise<void>((r) => s2.listen(0, r));
  const p2 = (s2.address() as AddressInfo).port;
  try {
    const t2 = await fetch(`http://127.0.0.1:${p2}/tiles/11/1100/701.png`);
    assert.equal(t2.status, 502);
  } finally {
    s2.close();
  }
});

test("prezzo 1€ su concerto/teatro -> azzerato (sconosciuto), non fascia fino10", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  const cheapShow = { ...DRAFT, title: "CONCERTO A 1 EURO", description: "biglietto 1 euro", url: "https://example.org/show1", venue: "Circolo X", address: "Via inventata 9, Milano", city: "MILANO" };
  const realShow = { ...DRAFT, title: "CONCERTO VERO", description: "biglietto 12 euro", url: "https://example.org/show2", venue: "Circolo Y", address: "Via inventata 10, Milano", city: "MILANO" };
  await runSync({ events, venues, geocoder: mockGeocoder(), extraSources: [testSource([cheapShow, realShow])] }, { env: {}, syncVenues: false, geocode: false });
  const all = events.listEvents({ all: true });
  const byTitle = Object.fromEntries(all.events.map((e) => [e.title, e]));
  assert.equal(byTitle["CONCERTO A 1 EURO"].priceBand, null);
  assert.equal(byTitle["CONCERTO VERO"].priceBand, "fino20");
  assert.equal(events.listEvents({ all: true, priceBand: "fino10" }).total, 0);
});

test("sync: eventi candlelight skippati da tutte le fonti", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  const cl = { ...DRAFT, title: "Candlelight: Vivaldi a lume di candela", url: "https://example.org/cl" };
  const res = await runSync({ events, venues, geocoder: mockGeocoder(), extraSources: [testSource([cl, DRAFT])] }, { env: {}, syncVenues: false, geocode: false });
  assert.equal(res.skipped, 1);
  assert.equal(res.inserted, 1);
  assert.equal(events.listEvents({ all: true }).total, 1);
});

test("filtro globale distanza: <=100km da Milano se geo, altrimenti testo MI; fuori -> skip", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  const geo = { async geocode() { return null; } };
  const far = { ...DRAFT, title: "EVENTO A SINGAPORE", url: "https://example.org/sg", lat: 1.35, lon: 103.8, venue: "Expo", address: "Singapore", city: "SINGAPORE" };
  const noGeoMi = { ...DRAFT, title: "EVENTO SENZA GEO MA MI", url: "https://example.org/nogeo", lat: null, lon: null, venue: "Circolo Milano", address: "Via Milano 1", city: "MILANO" };
  const noGeoRoma = { ...DRAFT, title: "EVENTO ROMA SENZA GEO", url: "https://example.org/rm", lat: null, lon: null, venue: "Teatro Roma", address: "Roma", city: "ROMA" };
  const res = await runSync({ events, venues, geocoder: geo, extraSources: [testSource([far, noGeoMi, noGeoRoma])] }, { env: {}, syncVenues: false, geocode: false });
  assert.equal(res.skipped, 2);
  assert.equal(res.inserted, 1);
  assert.equal(events.listEvents({ all: true }).events[0].title, "EVENTO SENZA GEO MA MI");
});

test("listEvents: from/to disattivano la finestra di default (anche passato e +20gg)", () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db, { today: () => "2026-11-03" });
  const base = { category: "altro" as const, saved: false, fetchedAt: "2026-11-03T00:00:00Z", sourceName: "T" };
  const mk = (id: string, start: string, end: string | null = null, big = false) =>
    events.upsertEvent({ ...DRAFT, id, title: id, start, end, venue: big ? "Stadio San Siro" : "Circolo X", address: "Via Milano 1", city: "MILANO", url: "https://x/" + id, ...base, big } as never);
  mk("IN-OGGI", "2026-11-03");
  mk("FUTURO-20", "2026-11-23");
  mk("PASSATO", "2020-01-15");
  mk("BIG-SALVATO", "2026-11-05", null, true);

  events.setSaved("FUTURO-20", true);
  events.setSaved("PASSATO", true);
  assert.equal(events.listEvents({}).total, 1); // default: solo finestra 15gg, big escluso -> solo IN-OGGI
  assert.equal(events.listEvents({ all: true, includeBig: true }).total, 4);
  assert.equal(events.listEvents({ from: "2026-11-20", to: "2026-11-25" }).total, 1);
  assert.equal(events.listEvents({ from: "2026-11-20", to: "2026-11-25" }).events[0].id, "FUTURO-20");
  assert.equal(events.listEvents({ from: "2020-01-01", to: "2020-12-31" }).total, 1);
  assert.equal(events.listEvents({ from: "2020-01-01", to: "2020-12-31" }).events[0].id, "PASSATO");
  assert.equal(events.listEvents({}).events.some((e) => e.id === "BIG-SALVATO"), false);
  // filtro 15gg/passati vale anche sui salvati
  assert.equal(events.listEvents({ savedOnly: true }).total, 0);
  assert.equal(events.listEvents({ savedOnly: true, all: true }).total, 2);
});

test("upsertEvent rifiuta date di calendario invalide (2025-02-31)", () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db, { today: () => "2026-11-03" });
  const base = { category: "altro" as const, saved: false, fetchedAt: "2026-11-03T00:00:00Z", sourceName: "T" };
  assert.throws(() => events.upsertEvent({ ...DRAFT, id: "bad", start: "2025-02-31", ...base } as never), /start/);
  assert.throws(() => events.upsertEvent({ ...DRAFT, id: "bad2", start: "2026-11-05", end: "2026-02-30", ...base } as never), /end/);
});
