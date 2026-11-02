import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
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
  start: "2099-09-25",
  end: "2099-09-27",
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
  const src = testSource([DRAFT, { ...DRAFT, title: "SECONDO EVENTO STESSO VENUE", url: "https://example.org/festa2", start: "2099-10-01" }]);
  const res = await runSync(
    { events, venues, geocoder, extraSources: [src] },
    { geocode: true, geocodeSleepMs: 0, env: {} },
  );
  assert.equal(res.errors.length, 0);
  assert.equal(res.inserted, 2);
  assert.equal(geocoder.calls.length, 1);
  const all = events.listEvents({ includePast: true });
  assert.equal(all.total, 2);
  assert.ok(all.events.every((e) => e.lat === 45.5741 && e.lon === 9.1635));
  assert.equal(all.events[0].category, "sagra");
  assert.equal(draftId(DRAFT).length, 16);
});

test("default list hides past events; includePast and explicit range show them", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  await runSync(
    { events, venues, geocoder: mockGeocoder(), extraSources: [testSource([DRAFT, PAST_DRAFT])] },
    { env: {} },
  );
  assert.equal(events.listEvents({}).total, 1);
  assert.equal(events.listEvents({ includePast: true }).total, 2);
  assert.equal(events.listEvents({ from: "2020-01-01" }).total, 2);
  assert.throws(() => events.listEvents({ from: "2026-02-30" }), /from/);
  assert.throws(() => events.listEvents({ bbox: "bad" }), /bbox/);
});

test("fts search, filters, saved toggle", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  await runSync({ events, venues, geocoder: mockGeocoder(), extraSources: [testSource([DRAFT, PAST_DRAFT])] }, { env: {} });
  assert.equal(events.listEvents({ q: "birra", includePast: true }).total, 1);
  assert.equal(events.listEvents({ q: "BIRRA", includePast: true }).total, 1);
  assert.equal(events.listEvents({ q: "   ", includePast: true }).total, 2);
  assert.equal(events.listEvents({ q: "nope", includePast: true }).total, 0);
  assert.equal(events.listEvents({ city: "senago", includePast: true }).total, 2);
  const ev = events.listEvents({ q: "birra", includePast: true }).events.find((e) => e.title === "FESTA DELLA BIRRA")!;
  assert.equal(ev.saved, false);
  assert.ok(events.setSaved(ev.id, true));
  assert.equal(events.listEvents({ savedOnly: true, includePast: true }).total, 1);
  assert.equal(events.listEvents({ category: "saved", includePast: true }).total, 1);
  assert.equal(events.getEvent(ev.id)?.saved, true);
  assert.ok(!events.setSaved("missing", true));
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

test("HTTP API end-to-end", async () => {
  const db = openDb(":memory:");
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  await runSync({ events, venues, geocoder: mockGeocoder(), extraSources: [testSource([DRAFT, PAST_DRAFT])] }, { env: {} });
  const server = createServer({ db, webDist: "/nonexistent", events, venues });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const get = async (p: string) => {
      const res = await fetch(`http://127.0.0.1:${port}${p}`);
      return { status: res.status, body: await res.json() };
    };
    assert.deepEqual(await get("/api/health"), { status: 200, body: { ok: true } });
    const all = await get("/api/events?includePast=1");
    assert.equal(all.body.total, 2);
    const def = await get("/api/events");
    assert.equal(def.body.total, 1);
    const filtered = await get("/api/events?category=sagra&from=2099-01-01");
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
    assert.equal((await get("/api/events?saved=1&includePast=1")).body.total, 1);
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
  } finally {
    server.close();
  }
});
